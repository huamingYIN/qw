import {
  Controller,
  Get,
  Post,
  UploadedFiles,
  Body,
  Res,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import type {
  ConvertRequest,
  HealthCheckResponse,
} from '@shared/api.interface';

import type { MulterFile } from './pdf-convert.service';
import { PdfConvertService } from './pdf-convert.service';

@Controller('api/convert')
export class PdfConvertController {
  constructor(private readonly pdfConvertService: PdfConvertService) {}

  @Get('health')
  healthCheck(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  @UseInterceptors(FilesInterceptor('images'))
  async convert(
    @UploadedFiles() files: MulterFile[] | undefined,
    @Body() body: ConvertRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No images uploaded');
    }

    const pdfBuffer: Buffer = await this.pdfConvertService.convert(files, {
      pageSize: body.pageSize,
      pageWidth: body.pageWidth !== undefined
        ? Number(body.pageWidth)
        : undefined,
      pageHeight: body.pageHeight !== undefined
        ? Number(body.pageHeight)
        : undefined,
      orientation: body.orientation,
      margin: body.margin,
      customMargin: body.customMargin !== undefined
        ? Number(body.customMargin)
        : undefined,
      fitMode: body.fitMode,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="images.pdf"',
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  }
}
