import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guest: true },
  },
  {
    path: '/',
    component: () => import('@/components/layout/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'Dashboard', component: () => import('@/views/DashboardView.vue') },
      { path: 'proxies', name: 'Proxies', component: () => import('@/views/ProxiesView.vue') },
      { path: 'chained-proxies', name: 'ChainedProxies', component: () => import('@/views/ChainedProxiesView.vue') },
      { path: 'paid-subs', name: 'PaidSubs', component: () => import('@/views/PaidSubsView.vue') },
      { path: 'templates', name: 'Templates', component: () => import('@/views/TemplatesView.vue') },
      { path: 'templates/new', name: 'TemplateNew', component: () => import('@/views/TemplateEditorView.vue') },
      { path: 'templates/:id/edit', name: 'TemplateEdit', component: () => import('@/views/TemplateEditorView.vue') },
      { path: 'custom-rules', name: 'CustomRules', component: () => import('@/views/CustomRulesView.vue') },
      { path: 'profiles', name: 'Profiles', component: () => import('@/views/ProfilesView.vue') },
      { path: 'profiles/new', name: 'ProfileNew', component: () => import('@/views/ProfileEditorView.vue') },
      { path: 'profiles/:id/edit', name: 'ProfileEdit', component: () => import('@/views/ProfileEditorView.vue') },
    ],
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, from, next) => {
  const auth = useAuthStore();

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    next({ name: 'Login' });
  } else if (to.meta.guest && auth.isLoggedIn) {
    next({ name: 'Dashboard' });
  } else {
    next();
  }
});

export default router;
