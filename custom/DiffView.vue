<script setup>
import { useCoreStore } from '@/stores/core';
import { computed, ref, watch } from 'vue';
import "@git-diff-view/vue/styles/diff-view.css";
import { DiffView, DiffModeEnum } from "@git-diff-view/vue";
import { generateDiffFile } from "@git-diff-view/file";
import { callAdminForthApi } from '@/utils';

const props = defineProps(['column', 'record', 'meta', 'resource', 'adminUser']);
const coreStore = useCoreStore();
const theme = computed(() => coreStore.theme);
const isMobile = computed(() => /(Android|iPhone|iPad|iPod)/i.test(navigator.userAgent));
const mode = computed(() => isMobile.value ? DiffModeEnum.Unified : DiffModeEnum.Split);

const oldContent = JSON.stringify(props.record[props.meta.resourceColumns.resourceDataColumnName].oldRecord, null, 2)
const newContent = JSON.stringify(props.record[props.meta.resourceColumns.resourceDataColumnName].newRecord, null, 2)

const diffFile = ref();

async function sendApproveRequest(approved) {
  const data = await callAdminForthApi({
    path: `/plugin/crud-approve/update-status`,
    method: 'POST',
    body: {
      connectorId: props.resource.connectorId,
      resourceId: props.resource.resourceId,
      action: props.record[props.meta.resourceColumns.resourceActionColumnName],
      recordId: props.record[props.meta.resourceColumns.resourceIdColumnName],
      approved: approved
    }
  });
}

function initDiffFile() {
  const file = generateDiffFile(
    'diff.json',
    oldContent,
    'diff.json',
    newContent,
    'json',
    'json'
  );
  file.initTheme(theme.value === 'dark' ? 'dark' : 'light');
  file.init();
  if (mode.value === DiffModeEnum.Split) {
    file.buildSplitDiffLines();
  } else {
    file.buildUnifiedDiffLines();
  }
  diffFile.value = file;
}

initDiffFile();

watch([mode, theme], ([m, t]) => {
  if (!diffFile.value) return;
  diffFile.value.initTheme(t === 'dark' ? 'dark' : 'light');
  if (m === DiffModeEnum.Split) {
    diffFile.value.buildSplitDiffLines();
  } else {
    diffFile.value.buildUnifiedDiffLines();
  }
});

</script>

<template>
  <DiffView
    :diff-file="diffFile"
    :diff-view-mode="mode"
    :diff-view-theme="theme === 'dark' ? 'dark' : 'light'"
    :diff-view-highlight="true"
    :diff-view-wrap="true"
    :diff-view-font-size="14"
  />
  <!-- approve button -->
   <button @click="sendApproveRequest(true)" class="btn btn-success me-2 mt-3">Approve</button>
   <button @click="sendApproveRequest(false)" class="btn btn-danger mt-3">Reject</button>
</template>
  