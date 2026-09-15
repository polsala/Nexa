import { LocaleType, mergeLocales } from "@univerjs/core";
import coreEn from "@univerjs/preset-sheets-core/locales/en-US";
import coreCa from "@univerjs/preset-sheets-core/locales/ca-ES";
import coreEs from "@univerjs/preset-sheets-core/locales/es-ES";
import filterEn from "@univerjs/preset-sheets-filter/locales/en-US";
import filterCa from "@univerjs/preset-sheets-filter/locales/ca-ES";
import filterEs from "@univerjs/preset-sheets-filter/locales/es-ES";
import sortEn from "@univerjs/preset-sheets-sort/locales/en-US";
import sortCa from "@univerjs/preset-sheets-sort/locales/ca-ES";
import sortEs from "@univerjs/preset-sheets-sort/locales/es-ES";
import validationEn from "@univerjs/preset-sheets-data-validation/locales/en-US";
import validationCa from "@univerjs/preset-sheets-data-validation/locales/ca-ES";
import validationEs from "@univerjs/preset-sheets-data-validation/locales/es-ES";
import conditionalEn from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import conditionalCa from "@univerjs/preset-sheets-conditional-formatting/locales/ca-ES";
import conditionalEs from "@univerjs/preset-sheets-conditional-formatting/locales/es-ES";
import findEn from "@univerjs/preset-sheets-find-replace/locales/en-US";
import findCa from "@univerjs/preset-sheets-find-replace/locales/ca-ES";
import findEs from "@univerjs/preset-sheets-find-replace/locales/es-ES";
export const locales = {
  [LocaleType.EN_US]: mergeLocales(
    coreEn,
    filterEn,
    sortEn,
    validationEn,
    conditionalEn,
    findEn,
  ),
  [LocaleType.CA_ES]: mergeLocales(
    coreCa,
    filterCa,
    sortCa,
    validationCa,
    conditionalCa,
    findCa,
  ),
  [LocaleType.ES_ES]: mergeLocales(
    coreEs,
    filterEs,
    sortEs,
    validationEs,
    conditionalEs,
    findEs,
  ),
};
export const localeKey = {
  en: LocaleType.EN_US,
  ca: LocaleType.CA_ES,
  es: LocaleType.ES_ES,
};
