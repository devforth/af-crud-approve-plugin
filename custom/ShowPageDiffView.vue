<script setup>
import { useRouter } from 'vue-router';
import ApprovalDiff from './ApprovalDiff.vue';

const router = useRouter();
const props = defineProps(['column', 'record', 'meta', 'resource', 'adminUser']);
</script>

<template>
  <ApprovalDiff
    :record="record"
    :meta="meta"
    :resource="resource"
    splitWhenWide
    @decided="router.push({ name: 'resource-list', params: { resourceId: resource.resourceId } })"
  />
</template>
