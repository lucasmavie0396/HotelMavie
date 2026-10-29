export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function fileUrl(file: string | null | undefined) {
  return file ? `/api/public/files/${file}` : '';
}

export function readImage(file: File, accept = ['image/png', 'image/jpeg', 'image/webp']) {
  return new Promise<string>((resolve, reject) => {
    if (!accept.includes(file.type)) {
      reject(new Error(`Formato nao suportado: usa ${accept.map((type) => type.split('/')[1].toUpperCase()).join(', ')}`));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('A imagem tem mais de 4 MB'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem'));
    reader.readAsDataURL(file);
  });
}
