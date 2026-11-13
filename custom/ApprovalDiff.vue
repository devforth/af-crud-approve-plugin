<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { callAdminForthApi } from '@/utils';
import { formatDateTime } from '@/utils/dateUtils';
import adminforth from '@/adminforth';
import { Button } from '@/afcl';
import { diffRows } from './diffRows';

const ROWS_COLLAPSED = 5;
const PENDING_STATUS = 1;
// written by the backend for backendOnly columns, see createApprovalRequest in index.ts
const HIDDEN_VALUES = new Set(['<hidden value before>', '<hidden value after>']);
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const props = defineProps({
  record: Object,
  meta: Object,
  resource: Object,
  // the show page lists every row, the list collapses long requests
  expanded: Boolean,
});
const emit = defineEmits(['decided']);
const { t } = useI18n();

const { oldRecord, newRecord } = props.record[props.meta.resourceColumns.dataColumnName];
const rows = diffRows(oldRecord, newRecord);
const action = props.record[props.meta.resourceColumns.actionColumnName];
const hasBefore = action !== 'create';
const hasAfter = action !== 'delete';
const isPending = props.record[props.meta.resourceColumns.statusColumnName] === PENDING_STATUS;

const showAll = ref(props.expanded);
const visibleRows = computed(() => showAll.value ? rows : rows.slice(0, ROWS_COLLAPSED));
const sending = ref(null);

function isPlaceholder(value) {
  return value === undefined || value === null || value.length === 0 || HIDDEN_VALUES.has(value);
}

function formatValue(value) {
  if (HIDDEN_VALUES.has(value)) return t('Hidden');
  if (isPlaceholder(value)) return t('Empty');
  if (typeof value === 'boolean') return value ? t('Yes') : t('No');
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'string' && ISO_DATETIME_RE.test(value)) return formatDateTime(value);
  // a JSON value that changed its shape (text ↔ object) arrives whole
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function valueClass(value) {
  return isPlaceholder(value)
    ? 'text-lightInputPlaceholderText dark:text-darkInputPlaceholderText'
    : 'text-lightShowTableBodyText dark:text-darkShowTableBodyText';
}

async function sendApproveRequest(approved) {
  sending.value = approved ? 'approve' : 'reject';
  const data = await callAdminForthApi({
    path: `/plugin/crud-approve/update-status`,
    method: 'POST',
    body: {
      connectorId: props.resource.connectorId,
      resourceId: props.resource.resourceId,
      action,
      recordId: props.record[props.meta.resourceColumns.recordIdColumnName],
      diffId: props.record[props.meta.resourceColumns.idColumnName],
      approved: approved
    }
  });
  sending.value = null;
  if (data.error && data.error !== 'Operation aborted by hook') {
    adminforth.alert({ message: t('Error: {error}', { error: data.error }), variant: 'danger' });
  } else {
    adminforth.alert({ message: approved ? t('Change approved') : t('Change rejected'), variant: 'success' });
    emit('decided');
  }
}
</script>

<template>
  <div class="af-crud-approve">
    <div
      v-if="rows.length"
      class="af-crud-approve-diff overflow-x-auto rounded-default border border-lightCardBorder dark:border-darkCardBorder"
    >
      <!-- fixed layout with a floor width: values wrap anywhere, yet the list column can't squeeze them to a few letters -->
      <table class="w-full min-w-[28rem] table-fixed text-sm">
        <thead>
          <tr class="text-left text-xs text-lightInputIconColor dark:text-darkInputIconColor">
            <th class="w-[35%] px-3 py-2 font-medium">{{ $t('Field') }}</th>
            <th v-if="hasBefore" class="px-3 py-2 font-medium">{{ $t('Before') }}</th>
            <th v-if="hasAfter" class="px-3 py-2 font-medium">{{ $t('After') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in visibleRows"
            :key="row.path.join('.')"
            class="align-top border-t border-lightShowTableBodyBorder dark:border-darkShowTableBodyBorder"
          >
            <td class="px-3 py-2 text-lightInputIconColor dark:text-darkInputIconColor">{{ row.path.join(' › ') }}</td>
            <td
              v-if="hasBefore"
              class="af-crud-approve-before px-3 py-2 [overflow-wrap:anywhere] bg-lightDangerSoft dark:bg-darkDangerSoft"
              :class="valueClass(row.before)"
            >
              {{ formatValue(row.before) }}
            </td>
            <td
              v-if="hasAfter"
              class="af-crud-approve-after px-3 py-2 [overflow-wrap:anywhere] bg-lightSuccessSoft dark:bg-darkSuccessSoft"
              :class="valueClass(row.after)"
            >
              {{ formatValue(row.after) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="text-lightInputPlaceholderText dark:text-darkInputPlaceholderText">
      {{ $t('No changes to display') }}
    </p>
    <Button
      v-if="!expanded && rows.length > ROWS_COLLAPSED"
      class="af-crud-approve-show-more mt-2"
      variant="secondary"
      size="sm"
      @click.stop="showAll = !showAll"
    >
      {{ showAll ? $t('Show less') : $t('Show {count} more', { count: rows.length - ROWS_COLLAPSED }) }}
    </Button>
    <!-- the list row opens the show page on click -->
    <div v-if="isPending" class="af-crud-approve-actions mt-4 flex gap-2" @click.stop>
      <Button
        class="af-crud-approve-approve-button flex-1"
        :loader="sending === 'approve'"
        :disabled="!!sending"
        @click="sendApproveRequest(true)"
      >
        {{ $t('Approve') }}
      </Button>
      <Button
        class="af-crud-approve-reject-button flex-1"
        variant="danger"
        :loader="sending === 'reject'"
        :disabled="!!sending"
        @click="sendApproveRequest(false)"
      >
        {{ $t('Reject') }}
      </Button>
    </div>
  </div>
</template>
