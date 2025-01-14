import { Component } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Store } from "@ngxs/store";

import { LayerBaseDialogComponent } from "./layer-base-dialog.component";
import { ResourcesService } from "../../../services/resources.service";
import { MapService } from "../../../services/map.service";
import { ToastService } from "../../../services/toast.service";
import { LayersService } from "../../../services/layers.service";
import type { LayerData } from "../../../models/models";

@Component({
    selector: "baselayer-add-dialog",
    templateUrl: "./layer-properties-dialog.component.html"
})
export class BaseLayerAddDialogComponent extends LayerBaseDialogComponent {
    constructor(resources: ResourcesService,
                layersService: LayersService,
                mapService: MapService,
                toastService: ToastService,
                http: HttpClient,
                store: Store) {
        super(resources, mapService, layersService, toastService, http, store);
        this.title = this.resources.addBaseLayer;
        this.isNew = true;
        this.isOverlay = false;
    }

    protected internalSave(layerData: LayerData): void {
        this.layersService.addBaseLayer(layerData);
    }
}
