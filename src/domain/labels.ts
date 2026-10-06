import type { AnomalyType, RiskLevel } from './types';

/** Spanish labels used in the CSV export (same strings as the frontend). */
export const TYPE_LABELS_ES: Record<AnomalyType, string> = {
  duplicate_exact: 'Duplicado exacto',
  duplicate_key: 'Clave duplicada',
  duplicate_near: 'Posible duplicado',
  missing_field: 'Campo faltante',
  empty_record: 'Registro casi vacío',
  type_mismatch: 'Tipo de dato inconsistente',
  invalid_format: 'Formato inválido',
  impossible_date: 'Fecha imposible',
  inconsistent_label: 'Etiqueta inconsistente',
  whitespace: 'Espacios sobrantes',
  out_of_range: 'Valor fuera de rango',
  negative_value: 'Valor negativo',
  future_date: 'Fecha futura',
  impossible_relation: 'Relación imposible',
  suspicious_threshold: 'Valor justo bajo un umbral',
  suspicious_round: 'Valores redondos sospechosos',
  benford: 'Desviación de la ley de Benford',
  multivariate_anomaly: 'Anomalía multivariante (IA)',
  mixed_types: 'Tipos mezclados en la columna',
};

export const RISK_LABELS_ES: Record<RiskLevel, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
};
