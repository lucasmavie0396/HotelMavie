<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { translated } from '@/i18n';
import { api, errorMessage } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { AccessProfile, UserRole } from '@/types';
import type { AccessLevel, AccessLevels } from '@/utils/access';
import { SECTIONS } from '@/utils/sections';

const { t } = useI18n();
const hotels = useHotelsStore();
const ROLE_LABELS = translated<UserRole>('labels.role', ['ADMIN', 'MANAGER', 'RECEPTION', 'CASHIER']);
const BASE_ROLES: UserRole[] = ['RECEPTION', 'MANAGER', 'CASHIER'];
const LEVELS = computed<{ value: AccessLevel; label: string; active: string }[]>(() => [
  { value: 'NONE', label: t('permissions.noAccess'), active: 'bg-slate-600 text-white' },
  { value: 'VIEW', label: t('permissions.view'), active: 'bg-sky-600 text-white' },
  { value: 'MANAGE', label: t('permissions.manage'), active: 'bg-emerald-600 text-white' },
]);

const profiles = ref<AccessProfile[]>([]);
const areas = ref<string[]>([]);
const defaults = ref<Record<string, AccessLevels>>({});
const selectedId = ref<number | null>(null);
const creating = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const form = reactive({ name: '', baseRole: 'RECEPTION' as UserRole, permissions: {} as AccessLevels });

const editing = computed(() => creating.value || selectedId.value !== null);
const selected = computed(() => profiles.value.find((profile) => profile.id === selectedId.value) ?? null);

async function load() {
  if (!hotels.selectedId) return;
  error.value = '';
  try {
    const [list, catalog] = await Promise.all([
      api.get<AccessProfile[]>('/access-profiles', { params: { hotelId: hotels.selectedId } }),
      api.get<{ areas: string[]; defaults: Record<string, AccessLevels> }>('/access-profiles/areas'),
    ]);
    profiles.value = list.data;
    areas.value = catalog.data.areas;
    defaults.value = catalog.data.defaults;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

function startNew() {
  creating.value = true;
  selectedId.value = null;
  notice.value = '';
  Object.assign(form, { name: '', baseRole: 'RECEPTION', permissions: { ...defaults.value.RECEPTION } });
}

function open(profile: AccessProfile) {
  creating.value = false;
  selectedId.value = profile.id;
  notice.value = '';
  Object.assign(form, { name: profile.name, baseRole: profile.baseRole, permissions: { ...profile.permissions } });
}

function onBaseRoleChange() {
  form.permissions = { ...defaults.value[form.baseRole] };
}

async function run(action: () => Promise<unknown>, message: string) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const save = () =>
  run(async () => {
    if (creating.value) {
      const { data } = await api.post<AccessProfile>('/access-profiles', { hotelId: hotels.selectedId, name: form.name, baseRole: form.baseRole, permissions: form.permissions });
      creating.value = false;
      selectedId.value = data.id;
    } else {
      await api.patch(`/access-profiles/${selectedId.value}`, { name: form.name, permissions: form.permissions });
    }
  }, t('permissions.saved'));

const remove = () => {
  if (!selected.value || !window.confirm(t('permissions.confirmRemove', { name: selected.value.name }))) return;
  const id = selected.value.id;
  run(async () => {
    await api.delete(`/access-profiles/${id}`);
    selectedId.value = null;
  }, t('permissions.removed'));
};

watch(
  () => hotels.selectedId,
  () => {
    creating.value = false;
    selectedId.value = null;
    load();
  },
);

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="permissions" :title="t('permissions.title')" :subtitle="t('permissions.subtitle')">
      <button class="btn" type="button" @click="startNew">{{ t('permissions.new') }}</button>
    </PageHeader>

    <p class="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">{{ t('permissions.builtIn') }}</p>
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div class="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div class="card space-y-2 self-start">
        <h2 class="font-semibold">{{ t('permissions.profiles') }}</h2>
        <p v-if="!profiles.length" class="text-sm text-slate-500">{{ t('permissions.none') }}</p>
        <button
          v-for="profile in profiles"
          :key="profile.id"
          type="button"
          class="block w-full rounded-md px-3 py-2 text-left text-sm"
          :class="profile.id === selectedId ? 'bg-indigo-600 text-white' : 'bg-slate-50 hover:bg-slate-100'"
          @click="open(profile)"
        >
          <span class="block font-medium">{{ profile.name }}</span>
          <span class="block text-xs opacity-75">{{ ROLE_LABELS[profile.baseRole] }} · {{ t('permissions.usersCount', profile.users) }}</span>
        </button>
      </div>

      <form v-if="editing" class="card space-y-4" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <input v-model="form.name" class="input self-start" :placeholder="t('permissions.name')" minlength="2" maxlength="80" required />
          <label class="text-sm">
            {{ t('permissions.basedOn') }}
            <select v-model="form.baseRole" class="input" :disabled="!creating" @change="onBaseRoleChange">
              <option v-for="role in BASE_ROLES" :key="role" :value="role">{{ ROLE_LABELS[role] }}</option>
            </select>
            <span class="mt-1 block text-xs text-slate-500">{{ t('permissions.basedOnHint') }}</span>
          </label>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-slate-600">
              <tr>
                <th class="py-2 pr-4">{{ t('permissions.area') }}</th>
                <th class="py-2"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="area in areas" :key="area" class="border-b border-slate-100">
                <td class="py-2 pr-4 font-medium">{{ SECTIONS[area]?.label ?? area }}</td>
                <td class="py-2">
                  <div class="inline-flex overflow-hidden rounded-md ring-1 ring-slate-200" role="radiogroup" :aria-label="SECTIONS[area]?.label ?? area">
                    <button
                      v-for="level in LEVELS"
                      :key="level.value"
                      type="button"
                      role="radio"
                      :aria-checked="form.permissions[area] === level.value"
                      class="px-3 py-1 text-xs font-medium"
                      :class="form.permissions[area] === level.value ? level.active : 'bg-white text-slate-600 hover:bg-slate-50'"
                      @click="form.permissions[area] = level.value"
                    >
                      {{ level.label }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-xs text-slate-500">{{ t('permissions.viewHint') }}</p>

        <div class="flex justify-end gap-2">
          <button v-if="selected" class="btn-secondary" type="button" :disabled="busy" @click="remove">{{ t('permissions.remove') }}</button>
          <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
        </div>
      </form>
      <p v-else class="card text-sm text-slate-500">{{ t('permissions.pick') }}</p>
    </div>
  </section>
</template>
