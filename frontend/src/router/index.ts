import { createRouter, createWebHistory } from 'vue-router';
import AppLayout from '@/layouts/AppLayout.vue';
import { useAuthStore } from '@/stores/auth';
import type { UserRole } from '@/types';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
    roles?: UserRole[];
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/h/:slug',
      name: 'public-hotel',
      component: () => import('@/views/PublicHotelView.vue'),
    },
    {
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
        { path: 'calendario', name: 'calendar', component: () => import('@/views/CalendarView.vue') },
        { path: 'reservas', name: 'reservations', component: () => import('@/views/ReservationsView.vue') },
        { path: 'reservas/:id', name: 'reservation', component: () => import('@/views/ReservationDetailView.vue') },
        { path: 'hospedes', name: 'guests', component: () => import('@/views/GuestsView.vue') },
        { path: 'quartos', name: 'rooms', component: () => import('@/views/RoomsView.vue') },
        { path: 'faturacao', name: 'invoices', component: () => import('@/views/InvoicesView.vue') },
        { path: 'contas-correntes', name: 'accounts', component: () => import('@/views/AccountsView.vue') },
        { path: 'caixa', name: 'cash', component: () => import('@/views/CashView.vue') },
        { path: 'pos', name: 'pos', component: () => import('@/views/PosView.vue') },
        { path: 'produtos', name: 'products', component: () => import('@/views/ProductsView.vue') },
        { path: 'stocks', name: 'stock', component: () => import('@/views/StockView.vue') },
        {
          path: 'compras',
          name: 'purchases',
          component: () => import('@/views/PurchasesView.vue'),
          meta: { roles: ['ADMIN', 'MANAGER'] },
        },
        {
          path: 'relatorios',
          name: 'reports',
          component: () => import('@/views/ReportsView.vue'),
          meta: { roles: ['ADMIN', 'MANAGER'] },
        },
        {
          path: 'funcionarios',
          name: 'users',
          component: () => import('@/views/UsersView.vue'),
          meta: { roles: ['ADMIN'] },
        },
        {
          path: 'configuracao',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
          meta: { roles: ['ADMIN', 'MANAGER'] },
        },
        {
          path: 'hoteis',
          name: 'hotels',
          component: () => import('@/views/HotelsView.vue'),
          meta: { roles: ['ADMIN'] },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'dashboard' };
  }
  if (to.meta.roles && (!auth.user || !to.meta.roles.includes(auth.user.role))) {
    return { name: 'dashboard' };
  }
});

export default router;
