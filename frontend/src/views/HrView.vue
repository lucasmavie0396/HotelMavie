<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue';
import PayrollPanel from '@/components/PayrollPanel.vue';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, errorMessage } from '@/services/api';
import { useAuthStore } from '@/stores/auth';
import { useHotelsStore } from '@/stores/hotels';
import type { ContractType, Employee, MonthlyRow, Shift, TimeEntry } from '@/types';
import { addDays, formatDateTime, todayIso, toIsoDate } from '@/utils/format';

const CONTRACTS: Record<ContractType, string> = {
  PERMANENT: 'Sem termo',
  FIXED_TERM: 'A termo',
  PART_TIME: 'Tempo parcial',
  INTERN: 'Estagio',
  OTHER: 'Outro',
};
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];

const auth = useAuthStore();
const hotels = useHotelsStore();
const isManager = computed(() => auth.user?.role !== 'RECEPTION');
type Tab = 'clock' | 'schedule' | 'employees' | 'monthly' | 'payroll';
const tab = ref<Tab>('clock');
const tabs = computed<{ value: Tab; label: string }[]>(() => [
  { value: 'clock', label: 'Ponto' },
  { value: 'schedule', label: 'Escala' },
  ...(isManager.value
    ? ([
        { value: 'employees', label: 'Funcionarios' },
        { value: 'monthly', label: 'Mapa mensal' },
        { value: 'payroll', label: 'Salarios' },
      ] as const)
    : []),
]);
const error = ref('');
const notice = ref('');
const busy = ref(false);

const employees = ref<Employee[]>([]);
const activeEmployees = computed(() => employees.value.filter((e) => e.active));

function mondayOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return toIsoDate(date);
}
const weekStart = ref(mondayOf(todayIso()));
const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart.value, i)));
const shifts = ref<Shift[]>([]);
const shiftForm = reactive({ employeeId: 0, date: todayIso(), startTime: '08:00', endTime: '16:00', breakMinutes: 60 });

const clockStatus = ref<{ employee: Employee | null; open: TimeEntry | null } | null>(null);
const entries = ref<TimeEntry[]>([]);
const clockFor = ref(0);
const now = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;

function emptyEmployee() {
  return {
    fullName: '', jobTitle: '', department: '', email: '', phone: '', taxId: '', socialSecurityNumber: '', iban: '',
    contractType: 'PERMANENT' as ContractType, startDate: todayIso(), endDate: '', weeklyHours: 40, baseSalary: 0, irsRate: 0, userId: 0, active: true, notes: '',
  };
}
const employeeForm = reactive(emptyEmployee());
const editingEmployee = ref<number | null>(null);
const users = ref<{ id: number; name: string; email: string; hotelId: number | null }[]>([]);

const month = ref(todayIso().slice(0, 7));
const monthly = ref<MonthlyRow[]>([]);

const hours = (minutes: number) => `${minutes < 0 ? '-' : ''}${Math.floor(Math.abs(minutes) / 60)}h${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
const elapsed = (from: string) => hours(Math.round((now.value.getTime() - new Date(from).getTime()) / 60000));

async function run(fn: () => Promise<unknown>, message = '') {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
    notice.value = message;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

async function loadEmployees() {
  employees.value = (await api.get<Employee[]>('/hr/employees', { params: { hotelId: hotels.selectedId } })).data;
}

async function loadShifts() {
  shifts.value = (await api.get<Shift[]>('/hr/shifts', { params: { hotelId: hotels.selectedId, from: weekDays.value[0], to: weekDays.value[6] } })).data;
}

async function loadClock() {
  clockStatus.value = (await api.get('/hr/clock')).data;
  entries.value = (await api.get<TimeEntry[]>('/hr/time-entries', { params: { hotelId: hotels.selectedId, from: addDays(todayIso(), -6), to: todayIso() } })).data;
}

async function loadMonthly() {
  monthly.value = (await api.get<MonthlyRow[]>('/hr/monthly', { params: { hotelId: hotels.selectedId, month: month.value } })).data;
}

async function load() {
  await run(async () => {
    await loadEmployees();
    if (tab.value === 'clock') await loadClock();
    if (tab.value === 'schedule') await loadShifts();
    if (tab.value === 'monthly') await loadMonthly();
    if (tab.value === 'employees' && auth.user?.role === 'ADMIN') {
      users.value = (await api.get('/users')).data;
    }
  });
}

watch(tab, load);

const clock = (employeeId?: number) =>
  run(async () => {
    const { data } = await api.post<TimeEntry>('/hr/clock', employeeId ? { employeeId } : {});
    await loadClock();
    notice.value = data.clockOut ? 'Saida registada' : 'Entrada registada';
  });

async function fixEntry(entry: TimeEntry) {
  const clockOut = window.prompt('Hora de saida (AAAA-MM-DD HH:mm):', entry.clockOut ? formatLocal(entry.clockOut) : `${todayIso()} 18:00`);
  if (!clockOut) return;
  const notes = window.prompt('Motivo da correcao:');
  if (!notes) return;
  await run(async () => {
    await api.patch(`/hr/time-entries/${entry.id}`, { clockOut: new Date(clockOut.replace(' ', 'T')).toISOString(), notes });
    await loadClock();
  }, 'Picagem corrigida');
}

function formatLocal(iso: string) {
  const date = new Date(iso);
  return `${toIsoDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function shiftsOn(employeeId: number, date: string) {
  return shifts.value.filter((s) => s.employeeId === employeeId && s.date.slice(0, 10) === date);
}

function moveWeek(days: number) {
  weekStart.value = addDays(weekStart.value, days);
  run(loadShifts);
}

const addShift = () =>
  run(async () => {
    await api.post('/hr/shifts', shiftForm);
    await loadShifts();
  }, 'Turno criado');

const removeShift = (shift: Shift) =>
  run(async () => {
    if (!window.confirm(`Apagar o turno ${shift.startTime}-${shift.endTime} de ${shift.employee.fullName}?`)) return;
    await api.delete(`/hr/shifts/${shift.id}`);
    await loadShifts();
  });

const copyWeek = () =>
  run(async () => {
    const { data } = await api.post('/hr/shifts/copy-week', { hotelId: hotels.selectedId, fromWeek: addDays(weekStart.value, -7), toWeek: weekStart.value });
    await loadShifts();
    notice.value = `${data.copied} turnos copiados da semana anterior`;
  });

function editEmployee(employee: Employee) {
  editingEmployee.value = employee.id;
  Object.assign(employeeForm, {
    ...emptyEmployee(),
    ...Object.fromEntries(Object.entries(employee).filter(([, v]) => v !== null && v !== undefined)),
    startDate: employee.startDate?.slice(0, 10) ?? todayIso(),
    endDate: employee.endDate?.slice(0, 10) ?? '',
    weeklyHours: Number(employee.weeklyHours ?? 40),
    baseSalary: Number(employee.baseSalary ?? 0),
    irsRate: Number(employee.irsRate ?? 0),
    userId: employee.userId ?? 0,
  });
}

function resetEmployee() {
  editingEmployee.value = null;
  Object.assign(employeeForm, emptyEmployee());
}

const saveEmployee = () =>
  run(async () => {
    const optional = (value: string) => value.trim() || undefined;
    const payload = {
      fullName: employeeForm.fullName,
      jobTitle: employeeForm.jobTitle,
      department: optional(employeeForm.department),
      email: optional(employeeForm.email),
      phone: optional(employeeForm.phone),
      taxId: optional(employeeForm.taxId),
      socialSecurityNumber: optional(employeeForm.socialSecurityNumber),
      iban: optional(employeeForm.iban.replace(/\s+/g, '').toUpperCase()),
      contractType: employeeForm.contractType,
      startDate: employeeForm.startDate,
      endDate: employeeForm.endDate || null,
      weeklyHours: employeeForm.weeklyHours,
      baseSalary: employeeForm.baseSalary || null,
      irsRate: employeeForm.irsRate || 0,
      userId: employeeForm.userId || null,
      active: employeeForm.active,
      notes: optional(employeeForm.notes),
    };
    if (editingEmployee.value) {
      await api.patch(`/hr/employees/${editingEmployee.value}`, payload);
    } else {
      await api.post('/hr/employees', { ...payload, hotelId: hotels.selectedId });
    }
    resetEmployee();
    await loadEmployees();
  }, 'Ficha guardada');

function exportMonthly() {
  const rows = [
    ['Funcionario', 'Funcao', 'Turnos', 'Horas previstas', 'Dias trabalhados', 'Horas trabalhadas', 'Diferenca', 'Picagens abertas', 'Picagens corrigidas'],
    ...monthly.value.map((r) => [r.fullName, r.jobTitle, r.scheduledShifts, hours(r.scheduledMinutes), r.workedDays, hours(r.workedMinutes), hours(r.differenceMinutes), r.openEntries, r.editedEntries]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `mapa-horas-${month.value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

onMounted(() => {
  load();
  timer = setInterval(() => (now.value = new Date()), 30_000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="space-y-6">
    <PageHeader section="hr" subtitle="Fichas, escalas, ponto e mapa mensal">
      <div class="flex rounded-lg bg-white p-0.5 text-sm shadow">
        <button
          v-for="item in tabs"
          :key="item.value"
          type="button"
          class="rounded px-4 py-1.5"
          :class="tab === item.value ? 'bg-indigo-600 text-white' : 'text-slate-700'"
          @click="tab = item.value"
        >
          {{ item.label }}
        </button>
      </div>
    </PageHeader>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <template v-if="tab === 'clock' && clockStatus">
      <div class="card flex flex-wrap items-center justify-between gap-4">
        <div v-if="clockStatus.employee">
          <p class="text-lg font-semibold">{{ clockStatus.employee.fullName }}</p>
          <p class="text-sm text-slate-600">
            {{ clockStatus.open ? `Em servico desde ${formatDateTime(clockStatus.open.clockIn)} (${elapsed(clockStatus.open.clockIn)})` : 'Fora de servico' }}
          </p>
        </div>
        <p v-else class="text-sm text-slate-500">A tua conta nao esta ligada a uma ficha de funcionario. Pede a um gestor para a associar.</p>
        <button v-if="clockStatus.employee" class="btn px-8 py-3 text-base" type="button" :disabled="busy" @click="clock()">
          {{ clockStatus.open ? 'Picar saida' : 'Picar entrada' }}
        </button>
      </div>

      <div v-if="isManager" class="card flex flex-wrap items-end gap-2">
        <label class="text-sm">
          Picar por outro funcionario
          <select v-model.number="clockFor" class="input">
            <option :value="0" disabled>Escolher...</option>
            <option v-for="e in activeEmployees" :key="e.id" :value="e.id">{{ e.fullName }}</option>
          </select>
        </label>
        <button class="btn-secondary" type="button" :disabled="!clockFor || busy" @click="clock(clockFor)">Picar entrada / saida</button>
      </div>

      <div class="card overflow-x-auto p-0">
        <h2 class="px-4 pt-4 font-semibold">Ultimos 7 dias</h2>
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 text-slate-600">
            <tr><th class="px-4 py-2">Funcionario</th><th class="px-4 py-2">Entrada</th><th class="px-4 py-2">Saida</th><th class="px-4 py-2">Duracao</th><th class="px-4 py-2">Notas</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.id" class="border-b border-slate-100">
              <td class="px-4 py-2">{{ entry.employee.fullName }} <span v-if="entry.source === 'MANAGER'" class="text-xs text-slate-500">(gestor)</span></td>
              <td class="px-4 py-2">{{ formatDateTime(entry.clockIn) }}</td>
              <td class="px-4 py-2">{{ entry.clockOut ? formatDateTime(entry.clockOut) : 'em servico' }}</td>
              <td class="px-4 py-2">
                {{ entry.clockOut ? hours(Math.round((new Date(entry.clockOut).getTime() - new Date(entry.clockIn).getTime()) / 60000)) : elapsed(entry.clockIn) }}
              </td>
              <td class="px-4 py-2 text-slate-500">
                {{ entry.notes }}
                <span v-if="entry.editedBy" class="text-xs">(corrigido por {{ entry.editedBy.name }})</span>
              </td>
              <td class="px-4 py-2 text-right">
                <button v-if="isManager" class="text-xs text-indigo-600 hover:underline" type="button" @click="fixEntry(entry)">Corrigir</button>
              </td>
            </tr>
            <tr v-if="!entries.length"><td colspan="6" class="px-4 py-4 text-center text-slate-500">Sem picagens</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-if="tab === 'schedule'">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <button class="btn-secondary" type="button" @click="moveWeek(-7)">&larr;</button>
          <span class="text-sm font-medium">Semana de {{ weekDays[0].split('-').reverse().join('/') }}</span>
          <button class="btn-secondary" type="button" @click="moveWeek(7)">&rarr;</button>
        </div>
        <button v-if="isManager" class="btn-secondary" type="button" :disabled="busy" @click="copyWeek">Copiar semana anterior</button>
      </div>

      <form v-if="isManager" class="card grid gap-3 sm:grid-cols-2 xl:grid-cols-6" @submit.prevent="addShift">
        <select v-model.number="shiftForm.employeeId" class="input xl:col-span-2" required>
          <option :value="0" disabled>Funcionario</option>
          <option v-for="e in activeEmployees" :key="e.id" :value="e.id">{{ e.fullName }}</option>
        </select>
        <input v-model="shiftForm.date" class="input" type="date" required />
        <div class="flex min-w-0 items-center gap-1">
          <input v-model="shiftForm.startTime" class="input min-w-0" type="time" aria-label="Inicio" required />
          <span class="text-slate-400">-</span>
          <input v-model="shiftForm.endTime" class="input min-w-0" type="time" aria-label="Fim" required />
        </div>
        <label class="flex items-center gap-1 text-sm">Pausa <input v-model.number="shiftForm.breakMinutes" class="input w-20" type="number" min="0" max="240" /> min</label>
        <button class="btn" type="submit" :disabled="busy || !shiftForm.employeeId">Adicionar turno</button>
      </form>

      <div class="card overflow-x-auto p-0">
        <table class="w-full table-fixed text-xs">
          <thead class="bg-slate-50 text-slate-600">
            <tr>
              <th class="w-40 px-3 py-2 text-left">Funcionario</th>
              <th v-for="(date, i) in weekDays" :key="date" class="px-2 py-2" :class="date === todayIso() ? 'text-indigo-700' : ''">
                {{ WEEKDAYS[i] }} {{ date.slice(8) }}/{{ date.slice(5, 7) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="employee in activeEmployees" :key="employee.id" class="border-t border-slate-100 align-top">
              <td class="px-3 py-2 font-medium">{{ employee.fullName }}<span class="block font-normal text-slate-500">{{ employee.jobTitle }}</span></td>
              <td v-for="date in weekDays" :key="date" class="px-1 py-1">
                <div v-for="shift in shiftsOn(employee.id, date)" :key="shift.id" class="mb-1 flex items-center justify-between rounded bg-indigo-50 px-1.5 py-1 text-indigo-900">
                  <span>{{ shift.startTime }}-{{ shift.endTime }}</span>
                  <button v-if="isManager" class="text-rose-600" type="button" aria-label="Apagar turno" @click="removeShift(shift)">&times;</button>
                </div>
              </td>
            </tr>
            <tr v-if="!activeEmployees.length"><td colspan="8" class="px-3 py-4 text-center text-slate-500">Sem funcionarios ativos</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-if="tab === 'employees'">
      <form class="card grid gap-3 sm:grid-cols-3" @submit.prevent="saveEmployee">
        <h2 class="font-semibold sm:col-span-3">{{ editingEmployee ? 'Editar ficha' : 'Nova ficha de funcionario' }}</h2>
        <input v-model="employeeForm.fullName" class="input" placeholder="Nome completo" required />
        <input v-model="employeeForm.jobTitle" class="input" placeholder="Funcao (ex.: Rececionista)" required />
        <input v-model="employeeForm.department" class="input" placeholder="Departamento" />
        <input v-model="employeeForm.email" class="input" type="email" placeholder="Email" />
        <input v-model="employeeForm.phone" class="input" placeholder="Telefone" />
        <input v-model="employeeForm.taxId" class="input" placeholder="NIF" />
        <input v-model="employeeForm.socialSecurityNumber" class="input" placeholder="N.o Seguranca Social" />
        <input v-model="employeeForm.iban" class="input sm:col-span-2" placeholder="IBAN" />
        <select v-model="employeeForm.contractType" class="input">
          <option v-for="(label, type) in CONTRACTS" :key="type" :value="type">{{ label }}</option>
        </select>
        <label class="text-sm">Inicio<input v-model="employeeForm.startDate" class="input" type="date" required /></label>
        <label class="text-sm">Fim (opcional)<input v-model="employeeForm.endDate" class="input" type="date" /></label>
        <label class="text-sm">Horas semanais<input v-model.number="employeeForm.weeklyHours" class="input" type="number" min="1" max="80" step="0.5" /></label>
        <label class="text-sm">Vencimento base<input v-model.number="employeeForm.baseSalary" class="input" type="number" min="0" step="0.01" /></label>
        <label class="text-sm" title="Taxa da tabela de retencao na fonte em vigor para a situacao do trabalhador">
          Retencao IRS (%)
          <input v-model.number="employeeForm.irsRate" class="input" type="number" min="0" max="60" step="0.01" />
        </label>
        <label v-if="auth.user?.role === 'ADMIN'" class="text-sm">
          Conta de acesso (para picar o ponto)
          <select v-model.number="employeeForm.userId" class="input">
            <option :value="0">Sem conta</option>
            <option v-for="u in users.filter((x) => !x.hotelId || x.hotelId === hotels.selectedId)" :key="u.id" :value="u.id">{{ u.name }} ({{ u.email }})</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm"><input v-model="employeeForm.active" type="checkbox" />Ativo</label>
        <textarea v-model="employeeForm.notes" class="input sm:col-span-3" rows="2" placeholder="Notas" />
        <div class="flex justify-end gap-2 sm:col-span-3">
          <button v-if="editingEmployee" class="btn-secondary" type="button" @click="resetEmployee">Cancelar</button>
          <button class="btn" type="submit" :disabled="busy">Guardar</button>
        </div>
      </form>

      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr><th class="px-4 py-3">Nome</th><th class="px-4 py-3">Funcao</th><th class="px-4 py-3">Contrato</th><th class="px-4 py-3">Horas/sem.</th><th class="px-4 py-3">Conta</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="employee in employees" :key="employee.id" class="border-b border-slate-100" :class="employee.active ? '' : 'text-slate-400'">
              <td class="px-4 py-3 font-medium">{{ employee.fullName }}</td>
              <td class="px-4 py-3">{{ employee.jobTitle }} <span class="text-slate-500">{{ employee.department }}</span></td>
              <td class="px-4 py-3">{{ employee.contractType ? CONTRACTS[employee.contractType] : '-' }}</td>
              <td class="px-4 py-3">{{ Number(employee.weeklyHours ?? 0) }}</td>
              <td class="px-4 py-3">{{ employee.user?.email ?? '-' }}</td>
              <td class="px-4 py-3 text-right"><button class="text-xs text-indigo-600 hover:underline" type="button" @click="editEmployee(employee)">Editar</button></td>
            </tr>
            <tr v-if="!employees.length"><td colspan="6" class="px-4 py-4 text-center text-slate-500">Sem fichas</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-if="tab === 'monthly'">
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="run(loadMonthly)">
        <label class="text-sm">Mes<input v-model="month" class="input" type="month" required /></label>
        <button class="btn" type="submit">Atualizar</button>
        <button class="btn-secondary" type="button" :disabled="!monthly.length" @click="exportMonthly">Exportar CSV</button>
      </form>
      <div class="card overflow-x-auto p-0">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th class="px-4 py-3">Funcionario</th>
              <th class="px-4 py-3 text-right">Turnos</th>
              <th class="px-4 py-3 text-right">Previstas</th>
              <th class="px-4 py-3 text-right">Dias</th>
              <th class="px-4 py-3 text-right">Trabalhadas</th>
              <th class="px-4 py-3 text-right">Diferenca</th>
              <th class="px-4 py-3">Alertas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in monthly" :key="row.employeeId" class="border-b border-slate-100">
              <td class="px-4 py-3 font-medium">{{ row.fullName }} <span class="text-slate-500">{{ row.jobTitle }}</span></td>
              <td class="px-4 py-3 text-right">{{ row.scheduledShifts }}</td>
              <td class="px-4 py-3 text-right">{{ hours(row.scheduledMinutes) }}</td>
              <td class="px-4 py-3 text-right">{{ row.workedDays }}</td>
              <td class="px-4 py-3 text-right">{{ hours(row.workedMinutes) }}</td>
              <td class="px-4 py-3 text-right" :class="row.differenceMinutes < 0 ? 'text-rose-700' : row.differenceMinutes > 0 ? 'text-amber-700' : ''">
                {{ hours(row.differenceMinutes) }}
              </td>
              <td class="px-4 py-3 text-xs">
                <span v-if="row.openEntries" class="mr-2 text-rose-700">{{ row.openEntries }} sem saida</span>
                <span v-if="row.editedEntries" class="text-slate-500">{{ row.editedEntries }} corrigidas</span>
              </td>
            </tr>
            <tr v-if="!monthly.length"><td colspan="7" class="px-4 py-4 text-center text-slate-500">Sem dados para este mes</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <PayrollPanel v-if="tab === 'payroll'" />
  </section>
</template>
