import { AdminForthResource, AdminUser, AllowedActionsEnum, HttpExtra } from "adminforth";

export interface PluginOptions {
    /**
     * Table where diffs are stored.
     */
    diffTableName: string;
    /**
     * Whether to review create/update/delete actions. You can pass functions here as well for more complex logic.
     */
    shouldReview: boolean | ((resource: AdminForthResource, action: AllowedForReviewActionsEnum, data: Object, user: AdminUser, oldRecord?: Object, extra?: HttpExtra) => Promise<boolean>);

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

export enum AllowedForReviewActionsEnum {
    create = AllowedActionsEnum.create,
    edit = AllowedActionsEnum.edit,
    delete = AllowedActionsEnum.delete
}

export enum ApprovalStatusEnum {
    pending = 'pending',
    approved = 'approved',
    rejected = 'rejected'
}