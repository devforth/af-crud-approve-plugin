CRUDApprove plugin allows to send all changes in the resources done from the admin panel for a manual approvement to a trusted users or roles. 
It will allow you to split the responsibility for updating records between users by providing manual approvement features with flexible configuration.
Requires separate table in the database to store approvement requests.

## Installation


```bash
npm i @adminforth/crud-approve --save
```

Create `crud_manual_approve.ts` in `resources` folder:

```ts title="./resources/crud_manual_approve.ts"
import CRUDApprovePlugin from '@adminforth/crud-approve';
import { AdminForthResourceInput, AdminForthDataTypes } from 'adminforth'
```

[Getting Started](<../001-gettingStarted.md>) will be used as base for this example.

