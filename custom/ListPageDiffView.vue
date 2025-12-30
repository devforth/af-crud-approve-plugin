<script setup>
import { useCoreStore } from '@/stores/core';
import { computed, ref, watch } from 'vue';
import "@git-diff-view/vue/styles/diff-view.css";
import { DiffView, DiffModeEnum } from "@git-diff-view/vue";
import { generateDiffFile } from "@git-diff-view/file";
import { callAdminForthApi } from '@/utils';
import adminforth from '@/adminforth';
import { Button } from '@/afcl'


const props = defineProps(['column', 'record', 'meta', 'resource', 'adminUser']);
const coreStore = useCoreStore();
const theme = computed(() => coreStore.theme);

const oldContent = JSON.stringify(props.record[props.meta.resourceColumns.dataColumnName].oldRecord, null, 2)
const newContent = JSON.stringify(props.record[props.meta.resourceColumns.dataColumnName].newRecord, null, 2)

const diffFile = ref();


async function sendApproveRequest(approved) {
  const code = await (window).adminforthTwoFaModal.get2FaConfirmationResult?.(undefined, "Approve/Reject Action Confirmation");
  const data = await callAdminForthApi({
    path: `/plugin/crud-approve/update-status`,
    method: 'POST',
    body: {
      meta: { confirmationResult: code },
      connectorId: props.resource.connectorId,
      resourceId: props.resource.resourceId,
      action: props.record[props.meta.resourceColumns.actionColumnName],
      recordId: props.record[props.meta.resourceColumns.recordIdColumnName],
      diffId: props.record[props.meta.resourceColumns.idColumnName],
      approved: approved
    }
  });
  if (data.error && data.error !== 'Operation aborted by hook') {
    adminforth.alert({ message: `Error: ${data.error}`, variant: 'warning' });
  } else {
    adminforth.alert({ message: `Successfully ${approved ? 'approved' : 'rejected'} the change.`, variant: 'success' });
    // reload page
    window.location.reload();
  }
}

function initDiffFile() {
  const file = generateDiffFile(
    'diff.json', oldContent.slice(2, -1),
    'diff.json', newContent.slice(2, -1),
    'json', 'json'
  );
  file.initTheme(theme.value === 'dark' ? 'dark' : 'light');
  file.init();
  file.buildUnifiedDiffLines();
  diffFile.value = file;
}

initDiffFile();

watch([theme], ([t]) => {
  if (!diffFile.value) return;
  diffFile.value.initTheme(t === 'dark' ? 'dark' : 'light');
  diffFile.value.buildUnifiedDiffLines();
});

</script>

<template>
  <DiffView
    :diff-file="diffFile"
    :diff-view-mode="DiffModeEnum.Unified"
    :diff-view-theme="theme === 'dark' ? 'dark' : 'light'"
    :diff-view-highlight="true"
    :diff-view-wrap="true"
    :diff-view-font-size="14"
  />
  <div v-if="record[meta.resourceColumns.statusColumnName] === 1" style="margin-top: 16px; display: flex; gap: 8px;">
    <Button style="background-color: green; color: white;" @click="sendApproveRequest(true)" :loader="false" class="w-full">Approve</Button>
    <Button style="background-color: red; color: white;" @click="sendApproveRequest(false)" :loader="false" class="w-full">Reject</Button>
  </div>
</template>
  