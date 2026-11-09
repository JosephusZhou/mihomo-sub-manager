<template>
  <router-view />
  <ToastContainer />
</template>

<script setup>
import { useAuthStore } from '@/stores/auth';
import ToastContainer from '@/components/ToastContainer.vue';

const auth = useAuthStore();
if (auth.isLoggedIn && !auth.user) {
  auth.fetchMe().catch(() => auth.logout());
}
</script>
