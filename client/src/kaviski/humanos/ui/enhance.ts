// Fork Kaviski (KAVISKI-HUMANOS.md): troca, nas telas das pessoas, todo <select> nativo pelo select do kit (select.ts),
// sem mexer no código de quem criou a tela. O <select> continua lá (escondido) e é a fonte da verdade: o select do kit
// mostra as opções dele, escolher dispara `change` nele, e mudanças feitas por código (value, selectedIndex, disabled,
// opções novas) aparecem no select do kit. Só vale para selects das nossas telas (classe kv-* no próprio select ou num
// pai); os do Habblaud original (Meu dia, timelapse) ficam como estão.
import { KvSelect, type KvOption } from './select';

const DONE = new WeakSet<HTMLSelectElement>();

/** É um select das telas do fork? */
function ours(sel: HTMLSelectElement): boolean {
  if (sel.dataset.kvNative !== undefined) return false;
  for (let el: Element | null = sel; el; el = el.parentElement) {
    if (el.classList.contains('ui-root')) return false;
    for (const c of el.classList) if (c.startsWith('kv-')) return true;
  }
  return false;
}

function optionsOf(sel: HTMLSelectElement): KvOption[] {
  return [...sel.options].map((o) => ({ value: o.value, label: o.textContent ?? o.value, disabled: o.disabled }));
}

/** Troca um <select> pelo select do kit (uma vez). */
export function kvEnhanceSelect(sel: HTMLSelectElement): KvSelect | null {
  if (DONE.has(sel) || sel.multiple) return null;
  DONE.add(sel);
  const ks = new KvSelect({
    options: optionsOf(sel),
    value: sel.value,
    label: sel.getAttribute('aria-label') ?? sel.closest('label')?.textContent?.trim() ?? undefined,
    onChange: (v) => {
      setValue.call(sel, v);
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    },
  });
  ks.el.classList.add('kv-ui-select--auto');
  if (sel.className) ks.el.dataset.from = sel.className;
  const paint = () => {
    ks.setOptions(optionsOf(sel));
    ks.value = sel.value;
    ks.disabled = sel.disabled;
    ks.el.hidden = sel.hidden;
  };
  // value/selectedIndex mudados por código (sem evento): intercepta o setter só deste select
  const proto = HTMLSelectElement.prototype;
  const vDesc = Object.getOwnPropertyDescriptor(proto, 'value')!;
  const iDesc = Object.getOwnPropertyDescriptor(proto, 'selectedIndex')!;
  const setValue = vDesc.set!;
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get: () => vDesc.get!.call(sel),
    set: (v: string) => {
      setValue.call(sel, v);
      paint();
    },
  });
  Object.defineProperty(sel, 'selectedIndex', {
    configurable: true,
    get: () => iDesc.get!.call(sel),
    set: (v: number) => {
      iDesc.set!.call(sel, v);
      paint();
    },
  });
  new MutationObserver(paint).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  sel.addEventListener('change', paint);
  sel.classList.add('kv-ui-native');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  sel.after(ks.el);
  paint();
  return ks;
}

/** Realça os selects que já existem e os que aparecerem depois (janelas criadas sob demanda). */
export function kvAutoEnhance(root: ParentNode = document.body): void {
  const scan = (n: ParentNode) => {
    if (n instanceof HTMLSelectElement) {
      if (ours(n)) kvEnhanceSelect(n);
      return;
    }
    n.querySelectorAll?.('select').forEach((s) => ours(s) && kvEnhanceSelect(s));
  };
  scan(root);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n instanceof Element) scan(n);
  }).observe(root as Node, { childList: true, subtree: true });
}
