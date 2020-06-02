import { Injectable, EventEmitter } from "@angular/core";
import { HttpClient, HttpParams, HttpEventType } from "@angular/common/http";
import { NgRedux, select } from "@angular-redux/store";
import { uniq } from "lodash";
import { Observable } from "rxjs";
import { timeout } from "rxjs/operators";

import { ResourcesService } from "./resources.service";
import { HashService, IPoiRouterData } from "./hash.service";
import { WhatsAppService } from "./whatsapp.service";
import { DatabaseService, ImageUrlAndData } from "./database.service";
import { RunningContextService } from "./running-context.service";
import { SpatialService } from "./spatial.service";
import { LoggingService } from "./logging.service";
import { GeoJsonParser } from "./geojson.parser";
import { SetCategoriesGroupVisibilityAction, AddCategoryAction } from "../reducres/layers.reducer";
import { ToastService } from "./toast.service";
import { SetOfflinePoisLastModifiedDateAction } from "../reducres/offline.reducer";
import { Urls } from "../urls";
import {
    MarkerData,
    LatLngAlt,
    PointOfInterestExtended,
    ApplicationState,
    Category,
    IconColorLabel,
    CategoriesGroup
} from "../models/models";
import { feature } from "@turf/helpers";

interface IImageItem {
    thumbnail: string;
    imageUrls: string[];
}

interface IUpdatesResponse {
    features: GeoJSON.Feature<GeoJSON.Geometry>[];
    images: IImageItem[];
}

export interface IPoiSocialLinks {
    poiLink: string;
    facebook: string;
    whatsapp: string;
    waze: string;
}

export interface ISelectableCategory extends Category {
    isSelected: boolean;
    selectedIcon: IconColorLabel;
    icons: IconColorLabel[];
    label: string;
}

@Injectable()
export class PoiService {
    private poisCache: PointOfInterestExtended[];
    private poisGeojson: GeoJSON.FeatureCollection<GeoJSON.Point>;
    private searchTermMap: Map<string, string[]>;

    public poiGeojsonFiltered: GeoJSON.FeatureCollection<GeoJSON.Point>;
    public poisChanged: EventEmitter<void>;

    @select((state: ApplicationState) => state.layersState.categoriesGroups)
    private categoriesGroups: Observable<CategoriesGroup[]>;

    constructor(private readonly resources: ResourcesService,
                private readonly httpClient: HttpClient,
                private readonly whatsappService: WhatsAppService,
                private readonly hashService: HashService,
                private readonly databaseService: DatabaseService,
                private readonly runningContextService: RunningContextService,
                private readonly geoJsonParser: GeoJsonParser,
                private readonly loggingService: LoggingService,
                private readonly toastService: ToastService,
                private readonly ngRedux: NgRedux<ApplicationState>
    ) {
        this.poisCache = [];
        this.poisChanged = new EventEmitter();

        this.resources.languageChanged.subscribe(() => {
            this.poisCache = [];
        });

        this.poiGeojsonFiltered = {
            type: "FeatureCollection",
            features: []
        };

        this.poisGeojson = {
            type: "FeatureCollection",
            features: []
        };

        this.searchTermMap = new Map<string, string[]>();
    }

    public async initialize() {
        this.resources.languageChanged.subscribe(() => this.updatePois());
        this.categoriesGroups.subscribe(() => this.updatePois());
        await this.syncCategories();
        await this.rebuildPois();
        this.toastService.progress({
            action: this.downloadPOIs
        });
    }

    private async rebuildPois() {
        this.poisGeojson.features = await this.databaseService.getPoisForClustering();
        for (let feature of this.poisGeojson.features) {
            let language = this.resources.getCurrentLanguageCodeSimplified();
            if (!feature.properties.poiNames[language] || feature.properties.poiNames[language].length === 0) {
                continue;
            }
            for (let name of feature.properties.poiNames[language]) {
                if (this.searchTermMap.has(name)) {
                    this.searchTermMap.get(name).push(feature.properties.poiId);
                } else {
                    this.searchTermMap.set(name, [feature.properties.poiId]);
                }
            }
        }
        this.updatePois();
    }

    private downloadPOIs = async (progressCallback: (value: number, text?: string) => void) => {
        try {
            // HM TODO: add progress text in resources service
            let lastModified = this.ngRedux.getState().offlineState.poisLastModifiedDate;
            let lastModifiedString = lastModified ? lastModified.toUTCString() : null;
            this.loggingService.info(`Getting POIs for: ${lastModifiedString} from server`);
            let updates = await this.getUpdatesWithProgress(lastModifiedString, (value) => progressCallback(value * 80));
            this.loggingService.info(`Storing POIs for: ${lastModifiedString}, got: ${updates.features.length}`);
            let lastUpdate = lastModified;
            var deletedIds = [] as string[];
            for (let update of updates.features) {
                let dateValue = new Date(update.properties.poiLastModified);
                if (dateValue > lastUpdate) {
                    lastUpdate = dateValue;
                }
                if (update.properties.poiDeleted) {
                    deletedIds.push(update.properties.poiId);
                }
            }
            this.databaseService.storePois(updates.features);
            this.databaseService.deletePois(deletedIds);
            this.ngRedux.dispatch(new SetOfflinePoisLastModifiedDateAction({ lastModifiedDate: lastUpdate }));
            this.loggingService.info(`Updating POIs for clustering from database: ${updates.features.length}`);
            progressCallback(90);
            await this.rebuildPois();
            this.loggingService.info(`Updated pois for clustering: ${this.poisGeojson.features.length}`);
            progressCallback(95);
            let imageAndData = [] as ImageUrlAndData[];
            for (let image of updates.images) {
                for (let imageUrl of image.imageUrls) {
                    imageAndData.push({ imageUrl: imageUrl, data: image.thumbnail });
                }
            }
            this.loggingService.info(`Storing images: ${imageAndData.length}`);
            this.databaseService.storeImages(imageAndData);
            progressCallback(100, "All set, POIS are up-to-date");

        } catch (ex) {
            this.loggingService.warning("Unable to sync public pois and categories - using local data: " + ex.message);
        }
    }

    public async getSerchResults(searchTerm: string): Promise<PointOfInterestExtended[]> {
        let ids = this.searchTermMap.get(searchTerm);
        if (!ids) {
            return [];
        }
        let results = [];
        for (let id of uniq(ids)) {
            let feature = await this.databaseService.getPoiById(id);
            let point = this.featureToPoint(feature);
            results.push(point);
        }
        return results;
    }

    private getUpdatesWithProgress(lastModifiedString: string, progressCallback: (value: number) => void)
        : Promise<IUpdatesResponse> {
        return new Promise((resolve, reject) => {
            this.httpClient.get(Urls.poiUpdates + lastModifiedString, {
                observe: "events",
                responseType: "json",
                reportProgress: true
            }).subscribe(event => {
                if (event.type === HttpEventType.DownloadProgress) {
                    progressCallback(event.loaded / event.total);
                }
                if (event.type === HttpEventType.Response) {
                    if (event.ok) {
                        progressCallback(1.0);
                        resolve(event.body as IUpdatesResponse);
                    } else {
                        reject(new Error(event.statusText));
                    }
                }
            }, error => reject(error));
        });
    }

    public updatePois() {
        let visibleCategories = [];
        for (let categoriesGroup of this.ngRedux.getState().layersState.categoriesGroups) {
            for (let category of categoriesGroup.categories) {
                if (category.visible) {
                    visibleCategories.push(category.name);
                }
            }
        }
        if (visibleCategories.length === 0) {
            this.poiGeojsonFiltered = {
                type: "FeatureCollection",
                features: []
            };
            this.poisChanged.next();
            return;
        }

        let visibleFeatures = [];
        let language = this.resources.getCurrentLanguageCodeSimplified();
        for (let feature of this.poisGeojson.features) {
            if (feature.properties.poiLanguage !== "all" && feature.properties.poiLanguage !== language) {
                continue;
            }
            if (visibleCategories.indexOf(feature.properties.poiCategory) === -1) {
                continue;
            }
            let titles = feature.properties.poiNames[language] || feature.properties.poiNames.all;
            feature.properties.title = (titles && titles.length > 0) ? titles[0] : "";
            feature.properties.hasExtraData = feature.properties.poiHasExtraData[language] || false;
            if (feature.properties.title || feature.properties.hasExtraData) {
                visibleFeatures.push(feature);
            }
        }
        this.poiGeojsonFiltered = {
            type: "FeatureCollection",
            features: visibleFeatures
        };
        this.poisChanged.next();
    }

    public async syncCategories(): Promise<void> {
        try {
            for (let categoriesGroup of this.ngRedux.getState().layersState.categoriesGroups) {
                let categories = await this.httpClient.get(Urls.poiCategories + categoriesGroup.type)
                    .pipe(timeout(10000)).toPromise() as Category[];
                let visibility = categoriesGroup.visible;
                if (this.runningContextService.isIFrame) {
                    this.ngRedux.dispatch(new SetCategoriesGroupVisibilityAction({
                        groupType: categoriesGroup.type,
                        visible: false
                    }));
                    visibility = false;
                }
                for (let category of categories) {
                    if (categoriesGroup.categories.find(c => c.name === category.name) == null) {
                        category.visible = visibility;
                        this.ngRedux.dispatch(new AddCategoryAction({
                            groupType: categoriesGroup.type,
                            category
                        }));
                    }
                }
            }
        } catch (ex) {
            this.loggingService.warning("Unable to sync categories, using local categories");
        }

    }

    public getSelectableCategories = async (): Promise<ISelectableCategory[]> => {
        let categoriesGroup = this.ngRedux.getState().layersState.categoriesGroups.find(g => g.type === "Points of Interest");
        let selectableCategories = [] as ISelectableCategory[];
        for (let category of categoriesGroup.categories) {
            if (category.name === "Wikipedia" || category.name === "iNature") {
                continue;
            }
            selectableCategories.push({
                name: category.name,
                isSelected: false,
                label: category.name,
                icon: category.icon,
                color: category.color,
                icons: category.items
                    .filter(i => i.iconColorCategory.icon !== "icon-nature-reserve")
                    .map(i => i.iconColorCategory)
            } as ISelectableCategory);
        }
        return selectableCategories;
    }

    public async getPoint(id: string, source: string, language?: string): Promise<PointOfInterestExtended> {
        let itemInCache = this.poisCache.find(p => p.id === id && p.source === source);
        if (itemInCache) {
            return { ...itemInCache };
        }
        if (!this.runningContextService.isOnline) {
            let feature = await this.databaseService.getPoiById(`${source}_${id}`);
            if (feature == null) {
                throw new Error("Failed to load POI from offline database.");
            }
            let point = this.featureToPoint(feature);
            return point;
        }
        let params = new HttpParams()
            .set("language", language || this.resources.getCurrentLanguageCodeSimplified());
        let poi = await this.httpClient.get(Urls.poi + source + "/" + id, { params }).toPromise() as PointOfInterestExtended;
        this.poisCache.splice(0, 0, poi);
        return { ...poi };
    }

    public async uploadPoint(poiExtended: PointOfInterestExtended): Promise<PointOfInterestExtended> {
        let uploadAddress = Urls.poi + "?language=" + this.resources.getCurrentLanguageCodeSimplified();
        this.poisCache = [];
        return this.httpClient.post(uploadAddress, poiExtended).toPromise() as Promise<PointOfInterestExtended>;
    }

    public getPoiSocialLinks(poiExtended: PointOfInterestExtended): IPoiSocialLinks {
        let poiLink = this.hashService.getFullUrlFromPoiId({
            source: poiExtended.source,
            id: poiExtended.id,
            language: this.resources.getCurrentLanguageCodeSimplified()
        } as IPoiRouterData);
        let escaped = encodeURIComponent(poiLink);
        return {
            poiLink,
            facebook: `${Urls.facebook}${escaped}`,
            whatsapp: this.whatsappService.getUrl(poiExtended.title, escaped) as string,
            waze: `${Urls.waze}${poiExtended.location.lat},${poiExtended.location.lng}`
        };
    }

    public mergeWithPoi(poiExtended: PointOfInterestExtended, markerData: MarkerData) {
        poiExtended.title = poiExtended.title || markerData.title;
        poiExtended.description = poiExtended.description || markerData.description;
        poiExtended.location = poiExtended.location || markerData.latlng;
        poiExtended.icon = poiExtended.icon || `icon-${markerData.type || "star"}`;

        markerData.urls.filter(u => u.mimeType.startsWith("image")).map(u => u.url).forEach(url => {
            poiExtended.imagesUrls.push(url);
        });
        return poiExtended;
    }

    private featureToPoint(f: GeoJSON.Feature): PointOfInterestExtended {
        let language = this.resources.getCurrentLanguageCodeSimplified();
        let imageUrls = uniq(Object.keys(f.properties).filter(k => k.toLowerCase().startsWith("image")).map(k => f.properties[k]));
        // HM TODO: remove this?
        // let references = Object.keys(f.properties).filter(k => k.toLowerCase().startsWith("website")).map(k => ({
        //     url: f.properties[k],
        //     sourceImageUrl: f.properties["poiSourceImageUrl" + k.replace("website", "")]
        // }));
        // references = uniqWith(references, (a, b) => a.url === b.url);
        let references = []; // no references due to offline.
        let description = f.properties["description:" + language] || f.properties.description;
        let poi = {
            id: f.properties.identifier,
            category: f.properties.poiCategory,
            hasExtraData: description != null || imageUrls.length > 0,
            icon: f.properties.poiIcon,
            iconColor: f.properties.poiIconColor,
            location: {
                lat: f.properties.poiGeolocation.lat,
                lng: f.properties.poiGeolocation.lon,
                alt: f.properties.poiAlt
            },
            itmCoordinates: {
                east: f.properties.poiItmEast,
                north: f.properties.poiItmNorth,
            },
            source: f.properties.poiSource,
            isEditable: f.properties.poiSource === "OSM",
            isRoute: f.geometry.type === "LineString" || f.geometry.type === "MultiLineString",
            isArea: f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon",
            lengthInKm: SpatialService.getLengthInMetersForGeometry(f.geometry) / 1000,
            dataContainer: null,
            featureCollection: {
                type: "FeatureCollection",
                features: [f]
            } as GeoJSON.FeatureCollection,
            references,
            contribution: {
                lastModifiedDate: new Date(f.properties["poiLastModified:" + language] || f.properties.poiLastModified),
                userAddress: f.properties["poiUserAddress:" + language] || f.properties.poiUserAddress,
                userName: f.properties["poiUserName:" + language] || f.properties.poiUserName
            },
            imagesUrls: imageUrls,
            description,
            title: Array.isArray(f.properties.poiNames[language]) && f.properties.poiNames[language].length !== 0
                ? f.properties.poiNames[language][0]
                : Array.isArray(f.properties.poiNames.all) && f.properties.poiNames.all.length !== 0
                    ? f.properties.poiNames.all[0]
                    : ""
        };
        if (!poi.title && !poi.hasExtraData) {
            return null;
        }
        return poi;
    }

    public async getClosestPoint(location: LatLngAlt, source?: string, language?: string): Promise<MarkerData> {
        if (!this.runningContextService.isOnline) {
            return null;
        }
        let params = new HttpParams()
            .set("location", location.lat + "," + location.lng)
            .set("source", source)
            .set("language", language);
        let feature = await this.httpClient.get(Urls.poiClosest, { params }).toPromise() as GeoJSON.Feature<GeoJSON.GeometryObject>;
        if (feature == null) {
            return null;
        }
        let dataContainer = this.geoJsonParser.toDataContainer({
            features: [feature],
            type: "FeatureCollection"
        }, this.resources.getCurrentLanguageCodeSimplified());
        let markerData = dataContainer.routes[0].markers[0];
        return markerData;
    }
}
