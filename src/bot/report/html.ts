export const html = (strings: TemplateStringsArray, ...values: string[]) =>
  String.raw({ raw: strings }, ...values);
