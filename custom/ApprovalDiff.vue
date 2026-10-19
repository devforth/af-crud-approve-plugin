<script setup>
import { useCoreStore } from '@/stores/core';
import { computed, ref, watch, defineAsyncComponent, onMounted, useTemplateRef } from 'vue';
import { useElementSize } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { callAdminForthApi } from '@/utils';
import adminforth from '@/adminforth';
import { Button } from '@/afcl';

const DiffView = defineAsyncComponent(async () => {
  // pure styles come without tailwind preflight, which would otherwise reset fonts of the whole SPA
  await import("@git-diff-view/vue/styles/diff-view-pure.css");
  const { DiffView } = await import("@git-diff-view/vue");
  return DiffView;
});

// old and new records go side by side only when the container fits two JSON columns
const SPLIT_MIN_WIDTH_PX = 768;
const PENDING_STATUS = 1;

const props = defineProps({
  record: Object,
  meta: Object,
  resource: Object,
  // only for a container whose width does not follow its content, a table cell of auto layout would toggle the modes
  splitWhenWide: Boolean,
});
const emit = defineEmits(['decided']);
const { t } = useI18n();
const coreStore = useCoreStore();
const theme = computed(() => coreStore.theme === 'dark' ? 'dark' : 'light');

const { oldRecord, newRecord } = props.record[props.meta.resourceColumns.dataColumnName];
const oldContent = JSON.stringify(oldRecord, null, 2);
const newContent = JSON.stringify(newRecord, null, 2);
const hasChanges = oldContent !== newContent;
const isPending = props.record[props.meta.resourceColumns.statusColumnName] === PENDING_STATUS;

const { width } = useElementSize(useTemplateRef('container'));
const split = computed(() => props.splitWhenWide && width.value >= SPLIT_MIN_WIDTH_PX);

const diffFile = ref();
const diffModes = ref();
const sending = ref(null);

function buildDiffLines() {
  if (split.value) {
    diffFile.value.buildSplitDiffLines();
  } else {
    diffFile.value.buildUnifiedDiffLines();
  }
}

onMounted(async () => {
  if (!hasChanges) {
    return;
  }
  const { DiffModeEnum } = await import("@git-diff-view/vue");
  const { generateDiffFile } = await import("@git-diff-view/file");
  diffModes.value = DiffModeEnum;
  const file = generateDiffFile('diff.json', oldContent, 'diff.json', newContent, 'json', 'json');
  file.initTheme(theme.value);
  file.init();
  diffFile.value = file;
  buildDiffLines();
});

watch([split, theme], () => {
  if (!diffFile.value) return;
  diffFile.value.initTheme(theme.value);
  buildDiffLines();
});

async function sendApproveRequest(approved) {
  sending.value = approved ? 'approve' : 'reject';
  const data = await callAdminForthApi({
    path: `/plugin/crud-approve/update-status`,
    method: 'POST',
    body: {
      connectorId: props.resource.connectorId,
      resourceId: props.resource.resourceId,
      action: props.record[props.meta.resourceColumns.actionColumnName],
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
  <div ref="container" class="af-crud-approve">
    <div
      v-if="diffFile"
      class="af-crud-approve-diff overflow-hidden rounded-default border border-lightCardBorder dark:border-darkCardBorder"
    >
      <DiffView
        :diff-file="diffFile"
        :diff-view-mode="split ? diffModes.Split : diffModes.Unified"
        :diff-view-theme="theme"
        :diff-view-highlight="true"
        :diff-view-wrap="true"
        :diff-view-font-size="13"
      />
    </div>
    <p v-else-if="!hasChanges" class="text-lightInputPlaceholderText dark:text-darkInputPlaceholderText">
      {{ $t('No changes to display') }}
    </p>
    <div v-if="isPending" class="af-crud-approve-actions mt-4 flex gap-2">
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

<style>
/* the diff view sets Menlo inline on the tables of both modes */
.af-crud-approve-diff .diff-table-scroll-container,
.af-crud-approve-diff .diff-table-wrapper {
  font-family: theme('fontFamily.mono') !important;
}

.af-crud-approve-diff .diff-tailwindcss-wrapper[data-theme="light"] .diff-style-root {
  --diff-border--: theme('colors.lightCardBorder');
  --diff-plain-content--: theme('colors.lightCardBackground');
  --diff-plain-lineNumber--: theme('colors.lightCardBackground');
  --diff-plain-lineNumber-color--: theme('colors.lightInputPlaceholderText');
  --diff-expand-content--: theme('colors.lightCardBackgroundHover');
  --diff-expand-lineNumber--: theme('colors.lightCardBackgroundHover');
  --diff-expand-lineNumber-color--: theme('colors.lightInputPlaceholderText');
  --diff-empty-content--: theme('colors.lightCardBackgroundHover');
  --diff-hunk-content--: theme('colors.lightCardBackgroundHover');
  --diff-hunk-lineNumber--: theme('colors.lightCardBackgroundHover');
  --diff-hunk-lineNumber-hover--: theme('colors.lightPrimary');
  --diff-hunk-content-color--: theme('colors.lightShowTableUnderHeadingText');
  --diff-add-widget--: theme('colors.lightPrimary');
  --diff-add-widget-color--: theme('colors.lightPrimaryContrast');
  --diff-add-content--: theme('colors.lightSuccessSoft');
  --diff-add-lineNumber--: theme('colors.lightSuccessSoft');
  --diff-add-content-highlight--: theme('colors.lightSuccessBorder');
  --diff-del-content--: theme('colors.lightDangerSoft');
  --diff-del-lineNumber--: theme('colors.lightDangerSoft');
  --diff-del-content-highlight--: theme('colors.lightDangerBorder');
  color: theme('colors.lightShowTableBodyText');
}

.af-crud-approve-diff .diff-tailwindcss-wrapper[data-theme="dark"] .diff-style-root {
  --diff-border--: theme('colors.darkCardBorder');
  --diff-plain-content--: theme('colors.darkCardBackground');
  --diff-plain-lineNumber--: theme('colors.darkCardBackground');
  --diff-plain-lineNumber-color--: theme('colors.darkInputPlaceholderText');
  --diff-expand-content--: theme('colors.darkCardBackgroundHover');
  --diff-expand-lineNumber--: theme('colors.darkCardBackgroundHover');
  --diff-expand-lineNumber-color--: theme('colors.darkInputPlaceholderText');
  --diff-empty-content--: theme('colors.darkCardBackgroundHover');
  --diff-hunk-content--: theme('colors.darkCardBackgroundHover');
  --diff-hunk-lineNumber--: theme('colors.darkCardBackgroundHover');
  --diff-hunk-lineNumber-hover--: theme('colors.darkPrimary');
  --diff-hunk-content-color--: theme('colors.darkShowTableUnderHeadingText');
  --diff-add-widget--: theme('colors.darkPrimary');
  --diff-add-widget-color--: theme('colors.darkPrimaryContrast');
  --diff-add-content--: theme('colors.darkSuccessSoft');
  --diff-add-lineNumber--: theme('colors.darkSuccessSoft');
  --diff-add-content-highlight--: theme('colors.darkSuccessBorder');
  --diff-del-content--: theme('colors.darkDangerSoft');
  --diff-del-lineNumber--: theme('colors.darkDangerSoft');
  --diff-del-content-highlight--: theme('colors.darkDangerBorder');
  color: theme('colors.darkShowTableBodyText');
}
</style>
