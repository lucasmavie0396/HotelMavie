<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import PaymentTypeSelect from '@/components/PaymentTypeSelect.vue';
import { api, errorMessage, openPdf } from '@/services/api';
import { useHotelsStore } from '@/stores/hotels';
import type { CashRegister, Reservation } from '@/types';
import { formatDateTime, formatMoney } from '@/utils/format';

const props = defineProps<{ reservation: Reservation }>();
const emit = defineEmits<{ updated: [reservation: Reservation] }>();

const hotels = useHotelsStore();
const registers = ref<CashRegister[]>([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const opened = ref(false);
const form = reactive({ amount: 0, paymentTypeId: 0, cashSessionId: 0, reference: '', sendEmail: true });

const money = (value: string | number) => formatMoney(value, hotels.currency);
const confirmed = computed(() => Boolean(props.reservation.depositPaymentId));
const open = computed(() => ['PENDING', 'CONFIRMED'].includes(props.reservation.status));
const suggested = computed(() =>
  props.reservation.depositAmount !== null
    ? Number(props.reservation.depositAmount)
    : Math.round(Number(props.reservation.totalAmount) * Number(hotels.selected?.depositPercent ?? 60)) / 100,
);
const remaining = computed(() => Number(props.reservation.totalAmount) - Number(props.reservation.depositAmount ?? 0));
const visible = computed(() => confirmed.value || open.value);

watch(
  () => props.reservation,
  (reservation) => {
    Object.assign(form, {
      amount: suggested.value,
      paymentTypeId: reservation.depositPaymentTypeId ?? 0,
      reference: reservation.depositReference ?? '',
      sendEmail: Boolean(reservation.guest.email),
    });
    opened.value = reservation.depositAmount !== null && !reservation.depositPaymentId;
  },
  { immediate: true },
);

async function loadRegisters() {
  try {
    registers.value = (await api.get<CashRegister[]>('/cash-registers', { params: { hotelId: props.reservation.hotelId } })).data;
  } catch (e) {
    error.value = errorMessage(e);
  }
}

watch(
  opened,
  (value) => {
    if (value && !registers.value.length) loadRegisters();
  },
  { immediate: true },
);

async function run(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const confirm = () =>
  run(async () => {
    const { data } = await api.post<Reservation>(`/reservations/${props.reservation.id}/deposit/confirm`, {
      amount: Number(form.amount),
      paymentTypeId: form.paymentTypeId,
      cashSessionId: form.cashSessionId || undefined,
      reference: form.reference || undefined,
      sendEmail: form.sendEmail,
    });
    emit('updated', data);
    notice.value = form.sendEmail ? 'Sinal confirmado, reserva aprovada e comprovativo enviado ao cliente' : 'Sinal confirmado e reserva aprovada';
  });

const pdf = () => run(() => openPdf(`/reservations/${props.reservation.id}/deposit/pdf`));

const email = () =>
  run(async () => {
    const { data } = await api.post<{ status: string; recipient: string }>(`/reservations/${props.reservation.id}/deposit/email`);
    notice.value =
      data.status === 'SENT'
        ? `Comprovativo enviado para ${data.recipient}`
        : data.status === 'LOGGED'
          ? 'Email registado mas nao enviado (SMTP por configurar)'
          : 'O envio do email falhou';
  });
</script>

<template>
  <div v-if="visible" class="card space-y-3" :class="confirmed ? 'border-emerald-200' : reservation.depositAmount !== null ? 'border-amber-300 bg-amber-50/40' : ''">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="font-semibold">
        Sinal
        <span v-if="confirmed" class="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">recebido</span>
        <span v-else-if="reservation.depositAmount !== null" class="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">por confirmar</span>
      </h2>
      <div v-if="confirmed" class="flex gap-2">
        <button class="btn-secondary px-3 py-1 text-xs" type="button" :disabled="busy" @click="pdf">Comprovativo A4</button>
        <button v-if="reservation.guest.email" class="btn-secondary px-3 py-1 text-xs" type="button" :disabled="busy" @click="email">Enviar ao cliente</button>
      </div>
      <button v-else-if="open && !opened" class="btn-secondary px-3 py-1 text-xs" type="button" @click="opened = true">Registar sinal</button>
    </div>

    <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-700">{{ notice }}</p>

    <dl v-if="confirmed" class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
      <div><dt class="text-slate-500">Valor</dt><dd class="font-semibold">{{ money(reservation.depositAmount ?? 0) }}</dd></div>
      <div><dt class="text-slate-500">Pagamento</dt><dd>{{ reservation.depositPaymentType?.name ?? '-' }} · {{ reservation.depositReference ?? 'sem referencia' }}</dd></div>
      <div><dt class="text-slate-500">Confirmado</dt><dd>{{ reservation.depositConfirmedAt ? formatDateTime(reservation.depositConfirmedAt) : '-' }} · {{ reservation.depositConfirmedBy?.name ?? '' }}</dd></div>
      <div><dt class="text-slate-500">Restante (check-in/out)</dt><dd class="font-semibold">{{ money(remaining) }}</dd></div>
    </dl>

    <template v-else-if="opened && open">
      <p v-if="reservation.depositAmount !== null && reservation.depositReference" class="text-sm text-slate-700">
        O cliente indicou o pagamento de <strong>{{ money(reservation.depositAmount) }}</strong>
        <template v-if="reservation.depositPaymentType"> por {{ reservation.depositPaymentType.name }}</template>
        com a referencia <strong class="font-mono">{{ reservation.depositReference }}</strong>. Confirma no extrato antes de aprovar.
      </p>
      <form class="grid gap-3 sm:grid-cols-4" @submit.prevent="confirm">
        <label class="text-sm">
          Valor recebido
          <input v-model.number="form.amount" class="input" type="number" min="0.01" :max="Number(reservation.totalAmount)" step="0.01" required />
        </label>
        <div class="grid gap-2 text-sm sm:col-span-2 sm:grid-cols-2">
          <span class="sm:col-span-2">Tipo de pagamento e referencia</span>
          <PaymentTypeSelect v-model:type-id="form.paymentTypeId" v-model:cash-session-id="form.cashSessionId" v-model:reference="form.reference" :registers="registers" />
        </div>
        <div class="flex flex-col justify-end gap-2">
          <label class="flex items-center gap-2 text-sm" :class="reservation.guest.email ? '' : 'text-slate-400'">
            <input v-model="form.sendEmail" type="checkbox" :disabled="!reservation.guest.email" />
            Enviar comprovativo por email
          </label>
          <button class="btn" type="submit" :disabled="busy || !form.paymentTypeId">
            {{ reservation.status === 'PENDING' ? 'Confirmar sinal e aprovar' : 'Confirmar sinal' }}
          </button>
        </div>
      </form>
      <p class="text-xs text-slate-500">
        Restante depois do sinal: {{ money(Number(reservation.totalAmount) - Number(form.amount || 0)) }}, a cobrar no check-in ou no check-out com os consumos.
      </p>
    </template>
  </div>
</template>
