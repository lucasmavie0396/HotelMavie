<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, errorMessage } from '@/services/api';
import { previewPdfFrom } from '@/services/print';
import { useHotelsStore } from '@/stores/hotels';
import type { PayrollRun, PayrollSettings, Payslip, PayslipLine } from '@/types';
import { formatDateTime, formatMoney, todayIso } from '@/utils/format';

const { t } = useI18n();
const MONTHS = computed(() => Array.from({ length: 12 }, (_, i) => t(`labels.months[${i}]`)));

const hotels = useHotelsStore();
const runs = ref<(Omit<PayrollRun, 'payslips'> & { payslips: Pick<Payslip, 'grossPay' | 'netPay' | 'employerSs'>[] })[]>([]);
const current = ref<PayrollRun | null>(null);
const settings = reactive<PayrollSettings>({ employeeSsRate: 11, employerSsRate: 23.75, overtimeMultiplier: 1.25, subsidiesInTwelfths: false, holidayPayMonth: 6, christmasPayMonth: 12 });
const showSettings = ref(false);
const month = ref(todayIso().slice(0, 7));
const editing = ref<{ slip: Payslip; absenceHours: number; overtimeHours: number; holidayPay: number; christmasPay: number; irsRate: number; notes: string; lines: PayslipLine[] } | null>(null);
const error = ref('');
const notice = ref('');
const busy = ref(false);

const money = (value: string | number) => formatMoney(value, hotels.currency);
const period = (run: { year: number; month: number }) => `${MONTHS.value[run.month - 1]} ${run.year}`;
type MoneyKey = 'grossPay' | 'netPay' | 'employerSs' | 'employeeSs' | 'irsWithholding';
const sum = (list: Partial<Record<MoneyKey, string>>[], key: MoneyKey) => list.reduce((total, item) => total + Number(item[key] ?? 0), 0);
const isDraft = computed(() => current.value?.status === 'DRAFT');

async function load() {
  error.value = '';
  try {
    const params = { hotelId: hotels.selectedId };
    const [r, s] = await Promise.all([api.get('/hr/payroll/runs', { params }), api.get<PayrollSettings>('/hr/payroll/settings', { params })]);
    runs.value = r.data;
    Object.assign(settings, {
      ...s.data,
      employeeSsRate: Number(s.data.employeeSsRate),
      employerSsRate: Number(s.data.employerSsRate),
      overtimeMultiplier: Number(s.data.overtimeMultiplier),
    });
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function run(action: () => Promise<void>, message = '') {
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

const open = (id: number) =>
  run(async () => {
    current.value = (await api.get<PayrollRun>(`/hr/payroll/runs/${id}`)).data;
    editing.value = null;
  });

const createRun = () =>
  run(async () => {
    current.value = (await api.post<PayrollRun>('/hr/payroll/runs', { hotelId: hotels.selectedId, month: month.value })).data;
  }, t('payroll.created'));

const recalculate = () =>
  run(async () => {
    current.value = (await api.post<PayrollRun>(`/hr/payroll/runs/${current.value!.id}/recalculate`)).data;
  }, t('payroll.recalculated'));

const closeRun = () =>
  run(async () => {
    if (!window.confirm(t('payroll.confirmClose', { period: period(current.value!) }))) return;
    current.value = (await api.post<PayrollRun>(`/hr/payroll/runs/${current.value!.id}/close`)).data;
  }, t('payroll.closed'));

const removeRun = () =>
  run(async () => {
    if (!window.confirm(t('payroll.confirmDelete'))) return;
    await api.delete(`/hr/payroll/runs/${current.value!.id}`);
    current.value = null;
  });

const saveSettings = () =>
  run(async () => {
    await api.put('/hr/payroll/settings', { hotelId: hotels.selectedId, ...settings });
    showSettings.value = false;
  }, t('payroll.settingsSaved'));

function edit(slip: Payslip) {
  editing.value = {
    slip,
    absenceHours: Number(slip.absenceHours),
    overtimeHours: Number(slip.overtimeHours),
    holidayPay: Number(slip.holidayPay),
    christmasPay: Number(slip.christmasPay),
    irsRate: Number(slip.irsRate),
    notes: slip.notes ?? '',
    lines: (slip.extraLines ?? []).map((line) => ({ ...line })),
  };
}

const saveSlip = () =>
  run(async () => {
    const form = editing.value!;
    await api.patch(`/hr/payroll/payslips/${form.slip.id}`, {
      absenceHours: form.absenceHours,
      overtimeHours: form.overtimeHours,
      holidayPay: form.holidayPay,
      christmasPay: form.christmasPay,
      irsRate: form.irsRate,
      notes: form.notes || undefined,
      extraLines: form.lines.filter((line) => line.label.trim() && line.amount > 0),
    });
    current.value = (await api.get<PayrollRun>(`/hr/payroll/runs/${current.value!.id}`)).data;
    editing.value = null;
  }, t('payroll.slipSaved'));

async function preview(path: string, title: string) {
  try {
    await previewPdfFrom(path, {}, title, 'A4');
  } catch (e) {
    error.value = errorMessage(e);
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <div class="flex flex-wrap items-end gap-2">
      <form class="flex items-end gap-2" @submit.prevent="createRun">
        <label class="text-sm">{{ t('common.month') }}<input v-model="month" class="input" type="month" required /></label>
        <button class="btn" type="submit" :disabled="busy">{{ t('payroll.process') }}</button>
      </form>
      <button class="btn-secondary" type="button" @click="showSettings = !showSettings">{{ t('payroll.settings') }}</button>
    </div>

    <form v-if="showSettings" class="card grid gap-3 text-sm sm:grid-cols-3" @submit.prevent="saveSettings">
      <label>{{ t('payroll.employeeSs') }}<input v-model.number="settings.employeeSsRate" class="input" type="number" min="0" max="50" step="0.01" required /></label>
      <label>{{ t('payroll.employerSs') }}<input v-model.number="settings.employerSsRate" class="input" type="number" min="0" max="50" step="0.01" required /></label>
      <label>{{ t('payroll.overtimeMultiplier') }}<input v-model.number="settings.overtimeMultiplier" class="input" type="number" min="1" max="3" step="0.05" required /></label>
      <label class="flex items-center gap-2 sm:col-span-3"><input v-model="settings.subsidiesInTwelfths" type="checkbox" />{{ t('payroll.twelfths') }}</label>
      <template v-if="!settings.subsidiesInTwelfths">
        <label>
          {{ t('payroll.holidayMonth') }}
          <select v-model.number="settings.holidayPayMonth" class="input">
            <option v-for="(name, index) in MONTHS" :key="name" :value="index + 1">{{ name }}</option>
          </select>
        </label>
        <label>
          {{ t('payroll.christmasMonth') }}
          <select v-model.number="settings.christmasPayMonth" class="input">
            <option v-for="(name, index) in MONTHS" :key="name" :value="index + 1">{{ name }}</option>
          </select>
        </label>
      </template>
      <p class="text-xs text-slate-500 sm:col-span-3">
        {{ t('payroll.settingsHint') }}
      </p>
      <div class="flex justify-end gap-2 sm:col-span-3">
        <button class="btn-secondary" type="button" @click="showSettings = false">{{ t('common.cancel') }}</button>
        <button class="btn" type="submit" :disabled="busy">{{ t('common.save') }}</button>
      </div>
    </form>

    <div class="card overflow-x-auto p-0">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
          <tr>
            <th class="px-4 py-3">{{ t('common.month') }}</th>
            <th class="px-4 py-3 text-right">{{ t('payroll.payslips') }}</th>
            <th class="px-4 py-3 text-right">{{ t('payroll.gross') }}</th>
            <th class="px-4 py-3 text-right">{{ t('payroll.net') }}</th>
            <th class="px-4 py-3 text-right">{{ t('payroll.employerSsShort') }}</th>
            <th class="px-4 py-3">{{ t('common.status') }}</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in runs" :key="item.id" class="border-b border-slate-100" :class="current?.id === item.id ? 'bg-indigo-50' : ''">
            <td class="px-4 py-3 font-medium">{{ period(item) }}</td>
            <td class="px-4 py-3 text-right">{{ item.payslips.length }}</td>
            <td class="px-4 py-3 text-right">{{ money(sum(item.payslips, 'grossPay')) }}</td>
            <td class="px-4 py-3 text-right">{{ money(sum(item.payslips, 'netPay')) }}</td>
            <td class="px-4 py-3 text-right">{{ money(sum(item.payslips, 'employerSs')) }}</td>
            <td class="px-4 py-3">
              <span class="rounded-full px-2 py-0.5 text-xs" :class="item.status === 'CLOSED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                {{ item.status === 'CLOSED' ? t('payroll.statusClosed') : t('payroll.statusDraft') }}
              </span>
            </td>
            <td class="px-4 py-3 text-right"><button class="text-xs text-indigo-600 hover:underline" type="button" @click="open(item.id)">{{ t('payroll.open') }}</button></td>
          </tr>
          <tr v-if="!runs.length"><td colspan="7" class="px-4 py-6 text-center text-slate-500">{{ t('payroll.empty') }}</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="current" class="card space-y-3 p-0">
      <div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <h2 class="font-semibold">
          {{ period(current) }}
          <span class="font-normal text-slate-500">· {{ current.status === 'CLOSED' ? t('payroll.closedAt', { date: formatDateTime(current.closedAt!) }) : t('payroll.draft') }}</span>
        </h2>
        <div class="flex flex-wrap gap-2">
          <button class="btn-secondary" type="button" @click="preview(`/hr/payroll/runs/${current.id}/pdf`, t('payroll.mapTitle', { period: period(current) }))">{{ t('payroll.mapPdf') }}</button>
          <template v-if="isDraft">
            <button class="btn-secondary" type="button" :disabled="busy" @click="recalculate">{{ t('payroll.recalculate') }}</button>
            <button class="btn-secondary text-rose-700" type="button" :disabled="busy" @click="removeRun">{{ t('common.delete') }}</button>
            <button class="btn" type="button" :disabled="busy || !current.payslips.length" @click="closeRun">{{ t('payroll.closeMonth') }}</button>
          </template>
        </div>
      </div>
      <p v-if="!current.payslips.length" class="px-4 text-sm text-slate-500">{{ t('payroll.noEmployees') }}</p>

      <form v-if="editing" class="mx-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3" @submit.prevent="saveSlip">
        <h3 class="font-semibold sm:col-span-3">
          {{ editing.slip.fullName }}
          <span class="font-normal text-slate-500">· {{ t('payroll.hoursSummary', { scheduled: Number(editing.slip.scheduledHours), worked: Number(editing.slip.workedHours) }) }}</span>
        </h3>
        <label>{{ t('payroll.absenceHours') }}<input v-model.number="editing.absenceHours" class="input" type="number" min="0" step="0.25" /></label>
        <label>{{ t('payroll.overtimeHours') }}<input v-model.number="editing.overtimeHours" class="input" type="number" min="0" step="0.25" /></label>
        <label>{{ t('hr.irsRate') }}<input v-model.number="editing.irsRate" class="input" type="number" min="0" max="60" step="0.01" /></label>
        <label>{{ t('payroll.holidayPay') }}<input v-model.number="editing.holidayPay" class="input" type="number" min="0" step="0.01" /></label>
        <label>{{ t('payroll.christmasPay') }}<input v-model.number="editing.christmasPay" class="input" type="number" min="0" step="0.01" /></label>
        <label>{{ t('common.notes') }}<input v-model="editing.notes" class="input" maxlength="255" /></label>
        <div class="space-y-2 sm:col-span-3">
          <p class="text-xs text-slate-500">{{ t('payroll.linesHint') }}</p>
          <div v-for="(line, index) in editing.lines" :key="index" class="grid grid-cols-[1fr_110px_120px_90px_32px] items-center gap-2">
            <input v-model="line.label" class="input" :placeholder="t('common.description')" maxlength="60" />
            <input v-model.number="line.amount" class="input" type="number" min="0.01" step="0.01" :aria-label="t('common.value')" />
            <select v-model="line.kind" class="input">
              <option value="EARNING">{{ t('payroll.earning') }}</option>
              <option value="DEDUCTION">{{ t('payroll.deduction') }}</option>
            </select>
            <label class="flex items-center gap-1 text-xs"><input v-model="line.taxable" type="checkbox" :disabled="line.kind === 'DEDUCTION'" />{{ t('payroll.taxable') }}</label>
            <button class="text-rose-600" type="button" :aria-label="t('common.removeLine')" @click="editing.lines.splice(index, 1)">&times;</button>
          </div>
          <button class="text-xs text-indigo-600 hover:underline" type="button" @click="editing.lines.push({ label: '', amount: 0, kind: 'EARNING', taxable: true })">{{ t('common.addLine') }}</button>
        </div>
        <div class="flex justify-end gap-2 sm:col-span-3">
          <button class="btn-secondary" type="button" @click="editing = null">{{ t('common.cancel') }}</button>
          <button class="btn" type="submit" :disabled="busy">{{ t('payroll.saveRecalculate') }}</button>
        </div>
      </form>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead class="border-y border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-4 py-2">{{ t('payroll.worker') }}</th>
              <th class="px-4 py-2 text-right">{{ t('payroll.base') }}</th>
              <th class="px-4 py-2 text-right">{{ t('payroll.absences') }}</th>
              <th class="px-4 py-2 text-right">{{ t('payroll.overtime') }}</th>
              <th class="px-4 py-2 text-right">{{ t('payroll.subsidies') }}</th>
              <th class="px-4 py-2 text-right">{{ t('payroll.gross') }}</th>
              <th class="px-4 py-2 text-right">SS</th>
              <th class="px-4 py-2 text-right">IRS</th>
              <th class="px-4 py-2 text-right">{{ t('payroll.net') }}</th>
              <th class="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="slip in current.payslips" :key="slip.id" class="border-b border-slate-100">
              <td class="px-4 py-2 font-medium">
                {{ slip.fullName }}
                <span v-if="slip.manual" class="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">{{ t('payroll.edited') }}</span>
              </td>
              <td class="px-4 py-2 text-right">{{ money(slip.baseSalary) }}</td>
              <td class="px-4 py-2 text-right" :class="Number(slip.absenceDeduction) ? 'text-rose-700' : ''">{{ Number(slip.absenceHours) }} h</td>
              <td class="px-4 py-2 text-right">{{ Number(slip.overtimeHours) }} h</td>
              <td class="px-4 py-2 text-right">{{ money(Number(slip.holidayPay) + Number(slip.christmasPay)) }}</td>
              <td class="px-4 py-2 text-right">{{ money(slip.grossPay) }}</td>
              <td class="px-4 py-2 text-right">{{ money(slip.employeeSs) }}</td>
              <td class="px-4 py-2 text-right">{{ money(slip.irsWithholding) }}</td>
              <td class="px-4 py-2 text-right font-semibold">{{ money(slip.netPay) }}</td>
              <td class="space-x-3 px-4 py-2 text-right text-xs whitespace-nowrap">
                <button class="text-slate-600 hover:underline" type="button" @click="preview(`/hr/payroll/payslips/${slip.id}/pdf`, t('payroll.slipTitle', { name: slip.fullName, period: period(current) }))">{{ t('payroll.slip') }}</button>
                <button v-if="isDraft" class="text-indigo-600 hover:underline" type="button" @click="edit(slip)">{{ t('common.edit') }}</button>
              </td>
            </tr>
          </tbody>
          <tfoot v-if="current.payslips.length" class="bg-indigo-50 font-semibold">
            <tr>
              <td class="px-4 py-2">{{ t('common.total') }}</td>
              <td colspan="4"></td>
              <td class="px-4 py-2 text-right">{{ money(sum(current.payslips, 'grossPay')) }}</td>
              <td class="px-4 py-2 text-right">{{ money(sum(current.payslips, 'employeeSs')) }}</td>
              <td class="px-4 py-2 text-right">{{ money(sum(current.payslips, 'irsWithholding')) }}</td>
              <td class="px-4 py-2 text-right">{{ money(sum(current.payslips, 'netPay')) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="px-4 pb-4 text-xs text-slate-500">
        {{ t('payroll.footer', { amount: money(sum(current.payslips, 'employerSs')) }) }}
      </p>
    </div>
  </div>
</template>
