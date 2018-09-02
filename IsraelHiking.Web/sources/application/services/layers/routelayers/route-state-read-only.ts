import * as L from "leaflet";
import * as _ from "lodash";

import { RouteStateName } from "./iroute-state";
import { RouteStateBase } from "./route-state-base";
import { IRouteLayer } from "./iroute.layer";
import { RouteStateHelper } from "./route-state-helper";
import { RouteStatePoiHelper } from "./route-state-poi-helper";
import * as Common from "../../../common/IsraelHiking";

export class RouteStateReadOnly extends RouteStateBase {
    private polylines: L.LayerGroup;

    constructor(context: IRouteLayer) {
        super(context);
        this.polylines = L.layerGroup([]);
        this.initialize();
    }

    private addPolyline(latlngs: L.LatLng[]): void {
        let routePathOptions = { ...this.context.route.properties.pathOptions } as L.PathOptions;
        routePathOptions.dashArray = "30 10";
        routePathOptions.className = "segment-readonly-indicator";
        let polyline = L.polyline(latlngs, routePathOptions);
        this.polylines.addLayer(polyline);
    }

    public initialize() {
        this.context.mapService.map.addLayer(this.polylines);
        this.polylines.clearLayers();
        if (this.context.route.segments.length > 0) {
            let groupedLatLngs = this.context.mapService.getGroupedLatLngForAntPath(this.context.route.segments);
            for (let group of groupedLatLngs) {
                this.addPolyline(group);
            }
        }
        for (let marker of this.context.route.markers) {
            marker.marker = RouteStatePoiHelper.createPoiMarker(marker, false, this.context);
            let component = RouteStatePoiHelper.addComponentToPoiMarker(marker.marker, this.context);
            component.isEditMode = false;
            component.changeToEditMode = () => this.changeStateToEditPoi(marker.marker);
        }
        this.context.mapService.map.on("mousemove", this.onMouseMove);
        RouteStateHelper.createStartAndEndMarkers(this.context);
    }

    public clear() {
        RouteStateHelper.removeLayersFromMap(this.context);
        this.context.mapService.map.off("mousemove", this.onMouseMove);
        this.polylines.clearLayers();
        this.context.mapService.map.removeLayer(this.polylines);
    }

    public getStateName(): RouteStateName {
        return "ReadOnly";
    }

    private onMouseMove = (e: L.LeafletMouseEvent): void => {
        let response = this.context.snapToSelf(e.latlng);
        if (response.polyline == null) {
            this.context.polylineHovered.next(null);
        } else {
            this.context.polylineHovered.next(response.latlng);
        }
    }

    private changeStateToEditPoi(markerWithTitle: Common.IMarkerWithTitle) {
        let markerLatLng = markerWithTitle.getLatLng();
        this.context.setEditPoiState();
        // old markers are destroyed and new markers are created.
        let newMarker = _.find(this.context.route.markers, m => m.marker != null && m.marker.getLatLng().equals(markerLatLng));
        if (newMarker != null) {
            newMarker.marker.openPopup();
        }
    }
}