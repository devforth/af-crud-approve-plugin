import { AdminForthResource, AdminUser, AllowedActionsEnum, HttpExtra } from "adminforth";

export interface PluginOptions {
    /**
     * Column names mapping in the diff table.
     */
    resourceColumns: {
        idColumnName: string;
        recordIdColumnName: string;
        resourceIdColumnName: string;
        actionColumnName: string;
        dataColumnName: string;
        userIdColumnName: string;
        responserIdColumnName: string;
        statusColumnName: string;
        createdAtColumnName: string;
        extraColumnName: string;
    }

    /**
     * By default the user who created the approval request can't approve or reject it himself
     * (separation of duties / four-eyes principle). Set to true to disable this check.
     */
    allowSelfApproval?: boolean;

    /**
     * How the changes are shown in the Before / After table, per reviewed resource (key is its resourceId).
     *
     * Example: `{ promos: { listRowsLimit: 3, fieldsOrder: ['title', 'enabled', 'reward'] } }`
     */
    diffTable?: Record<string, {
        /**
         * Rows shown in the list view before "Show more". The show view always lists every row. Default 5.
         */
        listRowsLimit?: number;

        /**
         * Keys in the order their rows go in the table, unlisted keys follow in the order they are stored.
         * A column name orders columns: `'title'`. A dotted path orders keys inside a JSON column:
         * `'reward.type'`, inside every item of an array: `'promocodes.code'`, deeper: `'reward.limits.daily'`.
         * Only the column part is checked at startup, keys inside JSON are not known before requests come.
         */
        fieldsOrder?: string[];
    }>;
}

export enum AllowedForReviewActionsEnum {
    create = AllowedActionsEnum.create,
    edit = AllowedActionsEnum.edit,
    delete = AllowedActionsEnum.delete,
    custom = 'custom',
}

export enum ApprovalStatusEnum {
    pending = 1,
    approved = 2,
    rejected = 3
}