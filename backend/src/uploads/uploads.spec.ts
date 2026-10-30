import sharp from 'sharp';
import { detectImage, optimizeImage } from './uploads';

describe('otimizacao de imagens', () => {
  const noise = (width: number, height: number) =>
    sharp(Buffer.from(Array.from({ length: width * height * 3 }, (_, index) => (index * 37) % 256)), { raw: { width, height, channels: 3 } });

  it('reduz imagens grandes para 1600 px mantendo o formato', async () => {
    const original = await noise(2400, 1200).jpeg({ quality: 100 }).toBuffer();
    const optimized = await optimizeImage(original, 'jpg');
    const meta = await sharp(optimized).metadata();
    expect(detectImage(optimized)).toBe('jpg');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(800);
    expect(optimized.length).toBeLessThan(original.length);
  });

  it('nao aumenta imagens pequenas e devolve o original se nao ganhar tamanho', async () => {
    const original = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#4338ca' } }).png().toBuffer();
    const optimized = await optimizeImage(original, 'png');
    expect((await sharp(optimized).metadata()).width).toBe(40);
    expect(optimized.length).toBeLessThanOrEqual(original.length);
  });

  it('devolve os bytes originais quando a imagem esta corrompida', async () => {
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('nada')]);
    expect(await optimizeImage(broken, 'png')).toBe(broken);
  });
});
