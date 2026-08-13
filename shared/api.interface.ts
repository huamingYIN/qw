/* 前后端共享的类型写在这里 */

export interface HealthCheckResponse {
  status: 'ok';
  timestamp: string;
}

export type PageSize = 'a4' | 'letter' | 'original' | 'custom';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';
export type PageMargin = 'none' | 'small' | 'medium' | 'large' | 'custom';
export type FitMode = 'cover' | 'contain';

export interface ConvertRequest {
  pageSize: PageSize;
  pageWidth?: number;
  pageHeight?: number;
  orientation: PageOrientation;
  margin: PageMargin;
  customMargin?: number;
  fitMode: FitMode;
}
