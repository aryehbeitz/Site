import { HttpClient } from "@angular/common/http";
import { Observable, firstValueFrom } from "rxjs";
import { Store } from "@ngxs/store";

import { BaseMapComponent } from "../../base-map.component";
import { ResourcesService } from "../../../services/resources.service";
import { MapService } from "../../../services/map.service";
import { ToastService } from "../../../services/toast.service";
import { LayersService } from "../../../services/layers.service";
import type { LayerData, ApplicationState, EditableLayer, LocationState } from "../../../models/models";
import type { Immutable } from "immer";

export abstract class LayerBaseDialogComponent extends BaseMapComponent {
    public title: string;
    public isNew: boolean;
    public isOverlay: boolean;
    public layerData: EditableLayer;
    public location$: Observable<Immutable<LocationState>>;

    protected constructor(resources: ResourcesService,
                          protected readonly mapService: MapService,
                          protected readonly layersService: LayersService,
                          protected readonly toastService: ToastService,
                          private readonly http: HttpClient,
                          private readonly store: Store) {
        super(resources);
        this.layerData = {
            minZoom: LayersService.MIN_ZOOM,
            maxZoom: LayersService.MAX_NATIVE_ZOOM,
            key: "",
            address: "",
            opacity: 1.0,
            isEditable: true,
            isOfflineAvailable: false,
            isOfflineOn: true
        } as EditableLayer;
        
        this.location$ = this.store.select((state: ApplicationState) => state.locationState);
    }

    public onAddressChanged(address: string) {
        // in order to cuase changes in child component
        this.layerData = {
            ...this.layerData,
            address: decodeURI(address).replace("{zoom}", "{z}").trim()
        };
        this.updateLayerKeyIfPossible();
    }

    public onOpacityChanged(opacity: number) {
        this.layerData.opacity = opacity;
    }

    public saveLayer() {
        const layerData = {
            ...this.layerData,
            minZoom: +this.layerData.minZoom, // fix issue with variable saved as string...
            maxZoom: +this.layerData.maxZoom,
        } as LayerData;
        this.internalSave(layerData);
    }

    protected abstract internalSave(layerData: LayerData): void;

    public removeLayer() { } // should be derived if needed.

    private async updateLayerKeyIfPossible() {
        if (this.layerData.key) {
            return;
        }
        try {
            let address = `${this.layerData.address}/?f=json`;
            address = address.replace("//?f", "/?f"); // in case the address the user set ends with "/".
            const response = await firstValueFrom(this.http.get(address)) as { name: string };
            if (response && response.name) {
                this.layerData.key = response.name;
            }
        } catch {
            // ignore error
        }
    }
}
