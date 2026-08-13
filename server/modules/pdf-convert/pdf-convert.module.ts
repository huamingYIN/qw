import { Module } from '@nestjs/common';

import { PdfConvertController } from './pdf-convert.controller';
import { PdfConvertService } from './pdf-convert.service';

@Module({
  controllers: [PdfConvertController],
  providers: [PdfConvertService],
  exports: [PdfConvertService],
})
export class PdfConvertModule {}
