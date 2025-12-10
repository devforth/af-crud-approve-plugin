import { AdminForthResource, AdminUser, AllowedActionsEnum, HttpExtra } from "adminforth";

export interface PluginOptions {
    /**
     * Table where diffs are stored.
     */
    diffTableName: string;
    /**
     * Whether to review create/update/delete actions. You can pass functions here as well for more complex logic.
     */
    shouldReview: boolean | ((resource: AdminForthResource, action: AllowedActionsEnum | string, data: Object, user: AdminUser, oldRecord?: Object, extra?: HttpExtra) => Promise<boolean>);

    /**
     * Column names mapping in the diff table.
     */
    resourceColumns: {
        resourceIdColumnName: string;
        resourceRecordIdColumnName: string;
        resourceActionColumnName: string;
        resourceDataColumnName: string;
        resourceUserIdColumnName: string;
        resourceStatusColumnName: string;
        resourceCreatedAtColumnName: string;
    }
}

export enum ApprovalStatusEnum {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected'
}