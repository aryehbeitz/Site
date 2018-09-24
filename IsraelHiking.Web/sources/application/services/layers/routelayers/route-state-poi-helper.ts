﻿import { MatDialog } from "@angular/material";
import * as L from "leaflet";
import * as _ from "lodash";

import { IconsService } from "../../icons.service";
import { DrawingPoiMarkerPopupComponent } from "../../../components/markerpopup/drawing-poi-marker-popup.component";
import { IRouteLayer, IMarkerWithData } from "./iroute.layer";
import { RouteStateHelper } from "./route-state-helper";
import { PrivatePoiEditDialogComponent } from "../../../components/dialogs/private-poi-edit-dialog.component";
import * as Common from "../../../common/IsraelHiking";

export class RouteStatePoiHelper {

    public static createPoiMarker(markerData: Common.MarkerData, isEditable: boolean, context: IRouteLayer): Common.IMarkerWithTitle {
        let pathOptions = context.route.properties.pathOptions;
        let color = context.route.properties.pathOptions.color;
        let marker = L.marker(markerData.latlng,
            {
                draggable: isEditable,
                clickable: isEditable,
                riseOnHover: isEditable,
                icon: IconsService.createMarkerIconWithColorAndType(color, markerData.type),
                opacity: pathOptions.opacity
            } as L.MarkerOptions) as Common.IMarkerWithTitle;
        marker.identifier = markerData.id;
        context.mapService.setMarkerTitle(marker, markerData, color);
        marker.addTo(context.mapService.map);
        return marker;
    }

    public static addReadOnlyComponentToPoiMarker(marker: Common.IMarkerWithTitle, context: IRouteLayer): DrawingPoiMarkerPopupComponent {
        let factory = context.componentFactoryResolver.resolveComponentFactory(DrawingPoiMarkerPopupComponent);
        let containerDiv = L.DomUtil.create("div");
        let poiMarkerPopupComponentRef = factory.create(context.injector, [], containerDiv);
        poiMarkerPopupComponentRef.instance.setMarker(marker);
        poiMarkerPopupComponentRef.instance.setRouteLayer(context);
        poiMarkerPopupComponentRef.instance.angularBinding(poiMarkerPopupComponentRef.hostView);
        marker.bindPopup(containerDiv);
        return poiMarkerPopupComponentRef.instance;
    }

    private static openEditMarkerDialog(marker: Common.IMarkerWithTitle, context: IRouteLayer) {
        let dialogRef = context.matDialog.open(PrivatePoiEditDialogComponent);
        dialogRef.componentInstance.setMarkerAndRoute(marker, context);
        dialogRef.componentInstance.remove = () => {
            let routeMarker = _.find(context.route.markers, markerToFind => markerToFind.marker === marker);
            RouteStatePoiHelper.removePoi(routeMarker, context);
        };
    }

    public static addPoint(e: L.LeafletMouseEvent, context: IRouteLayer): IMarkerWithData {
        let snappingPointResponse = context.getSnappingForPoint(e.latlng);
        let markerData = {
            latlng: snappingPointResponse.latlng,
            title: "",
            type: IconsService.getAvailableIconTypes()[0]
        } as Common.MarkerData;
        if (snappingPointResponse.markerData) {
            markerData = snappingPointResponse.markerData;
        }
        let marker = RouteStatePoiHelper.createPoiMarker(markerData, true, context);
        marker.identifier = markerData.id;
        let markerWithData = markerData as IMarkerWithData;
        markerWithData.marker = marker;
        context.route.markers.push(markerWithData);
        RouteStatePoiHelper.setPoiMarkerEvents(marker, context);
        marker.fire("click");
        context.raiseDataChanged();
        return markerWithData;
    }

    public static setPoiMarkerEvents(marker: Common.IMarkerWithTitle, context: IRouteLayer) {
        marker.on("click",
            () => {
                RouteStatePoiHelper.openEditMarkerDialog(marker, context);
            });
        marker.on("drag", () => {
            let snappingResponse = context.getSnappingForPoint(marker.getLatLng());
            marker.setLatLng(snappingResponse.latlng);
        });
        marker.on("dragend", () => {
            let markerInArray = _.find(context.route.markers, markerToFind => markerToFind.marker === marker) as IMarkerWithData;
            markerInArray.latlng = marker.getLatLng();
            let snappingPointResponse = context.getSnappingForPoint(markerInArray.latlng);
            if (snappingPointResponse.markerData != null &&
                !markerInArray.title &&
                markerInArray.type === IconsService.getAvailableIconTypes()[0]) {
                markerInArray.title = snappingPointResponse.markerData.title;
                markerInArray.type = snappingPointResponse.markerData.type;
                markerInArray.description = snappingPointResponse.markerData.description;
                markerInArray.urls = snappingPointResponse.markerData.urls;
                marker.identifier = snappingPointResponse.markerData.id;
                let color = context.route.properties.pathOptions.color;
                marker.setIcon(IconsService.createMarkerIconWithColorAndType(color, snappingPointResponse.markerData.type));
                context.mapService.setMarkerTitle(marker, snappingPointResponse.markerData, color);
            }
            context.raiseDataChanged();
        });
    }

    private static removePoi(poi: IMarkerWithData, context: IRouteLayer) {
        context.route.markers.splice(context.route.markers.indexOf(poi), 1);
        RouteStateHelper.destroyMarker(poi.marker, context);
        context.raiseDataChanged();
    }
}