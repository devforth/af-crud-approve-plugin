<script setup>
import { useCoreStore } from '@/stores/core';
import { computed, ref, watch } from 'vue';
import "@git-diff-view/vue/styles/diff-view.css";
import { DiffView, DiffModeEnum } from "@git-diff-view/vue";
import { generateDiffFile } from "@git-diff-view/file";
import { callAdminForthApi } from '@/utils';
import adminforth from '@/adminforth';
import { Button } from '@/afcl'
import { useRouter } from 'vue-router';

const router = useRouter();
const props = defineProps(['column', 'record', 'meta', 'resource', 'adminUser']);
const coreStore = useCoreStore();
const theme = computed(() => coreStore.theme);
const isMobile = computed(() => /(Android|iPhone|iPad|iPod)/i.test(navigator.userAgent));
const mode = computed(() => isMobile.value ? DiffModeEnum.Unified : DiffModeEnum.Split);

const oldContent = JSON.stringify(props.record[props.meta.resourceColumns.dataColumnName].oldRecord, null, 2)
const newContent = JSON.stringify(props.record[props.meta.resourceColumns.dataColumnName].newRecord, null, 2)

const diffFile = ref();

// async function call2faModal() {
//   const code = await (window).adminforthTwoFaModal.get2FaConfirmationResult?.(undefined, "Approve/Reject Action Confirmation");
//   if (!code) {
//     adminforth.alert({ message: '2FA cancelled', variant: 'warning' });
//     return;
//   }
//   return code;
// }

async function sendApproveRequest(approved) {
  // const code = await call2faModal();
  // if (!code) {
  //   console.log('2FA code not provided, aborting');
  //   return;
  // }

  const data = await callAdminForthApi({
    path: `/plugin/crud-approve/update-status`,
    method: 'POST',
    body: {
      // code: code,
      connectorId: props.resource.connectorId,
      resourceId: props.resource.resourceId,
      action: props.record[props.meta.resourceColumns.actionColumnName],
      recordId: props.record[props.meta.resourceColumns.recordIdColumnName],
      diffId: props.record[props.meta.resourceColumns.idColumnName],
      approved: approved
    }
  });
  if (data.error) {
    adminforth.alert({ message: `Error: ${data.error}`, variant: 'warning' });
  } else {
    adminforth.alert({ message: `Successfully ${approved ? 'approved' : 'rejected'} the change.`, variant: 'success' });
    router.push(router.currentRoute.value.fullPath.split('/show')[0]);
  }
}

function initDiffFile() {
  const file = generateDiffFile(
    'diff.json', oldContent,
    'diff.json', newContent,
    'json', 'json'
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
  <div v-if="record[meta.resourceColumns.statusColumnName] === 1" style="margin-top: 16px; display: flex; gap: 8px;">
    <Button style="background-color: green; color: white;" @click="sendApproveRequest(true)" :loader="false" class="w-full">Approve</Button>
    <Button style="background-color: red; color: white;" @click="sendApproveRequest(false)" :loader="false" class="w-full">Reject</Button>
  </div>
</template>
  