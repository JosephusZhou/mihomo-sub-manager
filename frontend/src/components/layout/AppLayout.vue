<template>
  <div class="min-h-screen flex">
    <AppSidebar />
    <div class="flex-1 flex flex-col ml-64">
      <AppHeader />
      <main class="flex-1 p-6">
        <router-view v-slot="{ Component }">
          <keep-alive>
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup>
import AppSidebar from './AppSidebar.vue';
import AppHeader from './AppHeader.vue';
</script>
