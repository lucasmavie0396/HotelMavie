import { reactive } from 'vue';

export interface DialogRequest {
  title: string;
  message?: string;
  input?: 'text' | 'textarea' | null;
  value?: string;
  required?: boolean;
  confirmLabel?: string;
  danger?: boolean;
}

export const dialogState = reactive({
  open: false,
  request: { title: '' } as DialogRequest,
  value: '',
  resolve: null as ((value: string | null) => void) | null,
});

function show(request: DialogRequest) {
  dialogState.resolve?.(null);
  return new Promise<string | null>((resolve) => {
    Object.assign(dialogState, { open: true, request, value: request.value ?? '', resolve });
  });
}

export function finishDialog(value: string | null) {
  const resolve = dialogState.resolve;
  Object.assign(dialogState, { open: false, resolve: null });
  resolve?.(value);
}

export function askText(request: Omit<DialogRequest, 'input'> & { multiline?: boolean }) {
  return show({ ...request, input: request.multiline ? 'textarea' : 'text' });
}

export async function askConfirm(request: Omit<DialogRequest, 'input' | 'value' | 'required'>) {
  return (await show({ ...request, input: null })) !== null;
}
