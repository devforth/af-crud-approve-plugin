<script setup>
import { useCoreStore } from '@/stores/core';
import { computed, ref, watch } from 'vue';
import "@git-diff-view/vue/styles/diff-view.css";
import { DiffView, DiffModeEnum } from "@git-diff-view/vue";
import { generateDiffFile } from "@git-diff-view/file";

const props = defineProps(['column', 'record', 'meta', 'resource', 'adminUser']);
const coreStore = useCoreStore();
const theme = computed(() => coreStore.theme);
const isMobile = computed(() => /(Android|iPhone|iPad|iPod)/i.test(navigator.userAgent));
const mode = computed(() => isMobile.value ? DiffModeEnum.Unified : DiffModeEnum.Split);

const oldContent = JSON.stringify(props.record[props.meta.resourceColumns.resourceDataColumnName].oldRecord, null, 2)
const newContent = JSON.stringify(props.record[props.meta.resourceColumns.resourceDataColumnName].newRecord, null, 2)

const diffFile = ref();

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
</template>
  