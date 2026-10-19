<script setup>
import adminforth from '@/adminforth';
import ApprovalDiff from './ApprovalDiff.vue';

const props = defineProps(['column', 'record', 'meta', 'resource', 'adminUser']);
</script>

<template>
  <ApprovalDiff :record="record" :meta="meta" :resource="resource" @decided="adminforth.list.refresh()" />
</template>
