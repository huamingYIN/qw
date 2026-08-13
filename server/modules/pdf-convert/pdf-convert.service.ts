import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PDFDocument, PDFImage } from 'pdf-lib';

import type {
  PageSize,
  PageOrientation,
  PageMargin,
  FitMode,
} from '@shared/api.interface';

export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  destination?: string;
  filename?: string;
  path?: string;
}

interface ConvertParams {
  pageSize: PageSize;
  pageWidth?: number;
  pageHeight?: number;
  orientation: PageOrientation;
  margin: PageMargin;
  customMargin?: number;
  fitMode: FitMode;
}

interface ImageDrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MM_TO_PT = 2.8346456693;

const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  a4: { w: 595.28, h: 841.89 },
  letter: { w: 612, h: 792 },
};

const MARGINS: Record<string, number> = {
  none: 0,
  small: 10,
  medium: 20,
  large: 30,
};

function mmToPt(mm: number): number {
  return mm * MM_TO_PT;
}

function getPageSize(
  params: ConvertParams,
  imageWidth: number,
  imageHeight: number,
): { width: number; height: number } {
  let width: number;
  let height: number;

  switch (params.pageSize) {
    case 'a4':
    case 'letter': {
      const size = PAGE_SIZES[params.pageSize];
      width = size.w;
      height = size.h;
      break;
    }
    case 'original': {
      // 屏幕图片按 72 DPI 处理：1px = 1pt
      width = imageWidth;
      height = imageHeight;
      break;
    }
    case 'custom': {
      if (params.pageWidth === undefined || params.pageHeight === undefined) {
        throw new BadRequestException(
          'pageWidth and pageHeight are required for custom page size',
        );
      }
      width = mmToPt(params.pageWidth);
      height = mmToPt(params.pageHeight);
      break;
    }
    default:
      throw new BadRequestException(`Invalid pageSize: ${params.pageSize}`);
  }

  // 方向处理
  switch (params.orientation) {
    case 'portrait':
      if (width > height) {
        [width, height] = [height, width];
      }
      break;
    case 'landscape':
      if (height > width) {
        [width, height] = [height, width];
      }
      break;
    case 'auto': {
      const imageIsLandscape = imageWidth > imageHeight;
      const pageIsLandscape = width > height;
      if (imageIsLandscape !== pageIsLandscape &&
          params.pageSize !== 'original' &&
          params.pageSize !== 'custom') {
        [width, height] = [height, width];
      }
      break;
    }
    default:
      throw new BadRequestException(
        `Invalid orientation: ${params.orientation}`,
      );
  }

  return { width, height };
}

function calculateImageDraw(
  pageWidth: number,
  pageHeight: number,
  imageWidth: number,
  imageHeight: number,
  marginPt: number,
  fitMode: FitMode,
): ImageDrawRect {
  const drawableWidth: number = pageWidth - marginPt * 2;
  const drawableHeight: number = pageHeight - marginPt * 2;

  if (drawableWidth <= 0 || drawableHeight <= 0) {
    throw new BadRequestException('Margin too large for page size');
  }

  const imgRatio: number = imageWidth / imageHeight;
  const drawRatio: number = drawableWidth / drawableHeight;

  let drawWidth: number;
  let drawHeight: number;

  if (fitMode === 'cover') {
    // 铺满：图片覆盖整个可绘制区域，超出部分裁切
    if (imgRatio > drawRatio) {
      // 图片更宽 → 按高度适配，宽度溢出
      drawHeight = drawableHeight;
      drawWidth = drawHeight * imgRatio;
    } else {
      // 图片更高 → 按宽度适配，高度溢出
      drawWidth = drawableWidth;
      drawHeight = drawWidth / imgRatio;
    }
  } else {
    // contain：完整显示图片
    if (imgRatio > drawRatio) {
      // 图片更宽 → 按宽度适配
      drawWidth = drawableWidth;
      drawHeight = drawWidth / imgRatio;
    } else {
      // 图片更高 → 按高度适配
      drawHeight = drawableHeight;
      drawWidth = drawHeight * imgRatio;
    }
  }

  // 居中放置
  const x: number = (pageWidth - drawWidth) / 2;
  // pdf-lib 坐标原点在左下角
  const y: number = (pageHeight - drawHeight) / 2;

  return { x, y, width: drawWidth, height: drawHeight };
}

function getMarginPt(params: ConvertParams): number {
  if (params.margin === 'custom') {
    if (params.customMargin === undefined) {
      throw new BadRequestException(
        'customMargin is required when margin is "custom"',
      );
    }
    return mmToPt(params.customMargin);
  }
  const mm: number | undefined = MARGINS[params.margin];
  if (mm === undefined) {
    throw new BadRequestException(`Invalid margin: ${params.margin}`);
  }
  return mmToPt(mm);
}

function detectImageFormat(
  file: MulterFile,
): 'jpg' | 'png' | 'other' {
  const mimeType: string = file.mimetype?.toLowerCase() ?? '';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return 'jpg';
  }
  if (mimeType === 'image/png') {
    return 'png';
  }
  // fallback: 检查文件魔数
  const buf: Buffer = file.buffer;
  if (buf.length >= 3 &&
      buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e &&
      buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a &&
      buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'png';
  }
  return 'other';
}

/**
 * 将非 JPG/PNG 格式的图片转换为 PNG。
 * 优先使用 sharp，未安装时抛出明确错误。
 */
async function convertToPng(file: MulterFile): Promise<{
  buffer: Uint8Array;
  width: number;
  height: number;
}> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const result: Buffer = await sharp(file.buffer)
      .png()
      .toBuffer();
    const metadata: { width?: number; height?: number } =
      await sharp(result).metadata();
    return {
      buffer: new Uint8Array(result),
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
    };
  } catch (err) {
    throw new BadRequestException(
      `Unsupported image format: ${file.mimetype}. ` +
      'Server-side conversion requires "sharp" package.',
    );
  }
}

interface EmbeddedImage {
  image: PDFImage;
  width: number;
  height: number;
}

@Injectable()
export class PdfConvertService {
  private readonly logger = new Logger(PdfConvertService.name);

  async convert(
    files: MulterFile[],
    params: ConvertParams,
  ): Promise<Buffer> {
    if (files.length === 0) {
      throw new BadRequestException('No images provided');
    }

    const marginPt: number = getMarginPt(params);

    const pdfDoc: PDFDocument = await PDFDocument.create();
    let embeddedCount = 0;

    for (const file of files) {
      let embedded: EmbeddedImage;
      const format: 'jpg' | 'png' | 'other' = detectImageFormat(file);

      if (format === 'jpg') {
        const img = await pdfDoc.embedJpg(file.buffer);
        embedded = { image: img, width: img.width, height: img.height };
      } else if (format === 'png') {
        const img = await pdfDoc.embedPng(file.buffer);
        embedded = { image: img, width: img.width, height: img.height };
      } else {
        const converted = await convertToPng(file);
        const img = await pdfDoc.embedPng(converted.buffer);
        embedded = {
          image: img,
          width: converted.width || img.width,
          height: converted.height || img.height,
        };
      }

      const { width: pageW, height: pageH } = getPageSize(
        params,
        embedded.width,
        embedded.height,
      );

      const page = pdfDoc.addPage([pageW, pageH]);

      const draw: ImageDrawRect = calculateImageDraw(
        pageW,
        pageH,
        embedded.width,
        embedded.height,
        marginPt,
        params.fitMode,
      );

      page.drawImage(embedded.image, {
        x: draw.x,
        y: draw.y,
        width: draw.width,
        height: draw.height,
      });

      embeddedCount += 1;
    }

    const pdfBytes: Uint8Array = await pdfDoc.save();
    this.logger.log(
      `Converted ${embeddedCount} image(s) to PDF ` +
      `(${(pdfBytes.length / 1024).toFixed(1)} KB)`,
    );

    return Buffer.from(pdfBytes);
  }
}
