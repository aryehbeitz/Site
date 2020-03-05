import { Injectable } from "@angular/core";
import { InAppPurchase2, IAPProduct } from "@ionic-native/in-app-purchase-2/ngx";

import { RunningContextService } from "./running-context.service";
import { LoggingService } from "./logging.service";

@Injectable()
export class PurchaseService {
    public isOfflineAvailable: boolean;

    constructor(private readonly store: InAppPurchase2,
        private readonly runningContextService: RunningContextService,
        private readonly loggingService: LoggingService
    ) {
        this.isOfflineAvailable = false;
    }

    public initialize() {
        if (!this.runningContextService.isCordova) {
            return;
        }
        this.store.validator = "https://validator.fovea.cc/v1/validate?appName=il.org.osm.israelhiking" +
            "&apiKey=1245b587-4bbc-4fbd-a3f1-d51169a53063";
        this.store.register({
            id: "offline_map",
            alias: "offline map",
            type: this.store.PAID_SUBSCRIPTION
        });
        this.store.when("product").updated((product: IAPProduct) => {
            this.loggingService.debug("Product updated: " + JSON.stringify(product));
            if (product.owned) {
                this.loggingService.debug("Product owned!");
                this.isOfflineAvailable = true;
                return;
            }
        });
        this.store.when("product").approved(product => {
            try {
                this.loggingService.debug("Product approved: " + JSON.stringify(product));
            } catch { }
            return product.verify();
        });
        this.store.when("product").verified(product => {
            try {
                this.loggingService.debug("Product verified: " + JSON.stringify(product));
            } catch { }
            return product.finish();
        });
        this.store.refresh();
    }

    public order(applicationUsername: string) {
        this.loggingService.debug("Ordering product for: " + applicationUsername);
        this.store.order("offline_map", { applicationUsername });
    }
}