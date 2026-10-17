import { createElement } from 'react';
import { Button as HeroButton } from '@heroui/react/button';
import { Card as HeroCard } from '@heroui/react/card';
import { Checkbox as HeroCheckbox } from '@heroui/react/checkbox';
import { Input as HeroInput } from '@heroui/react/input';
import { ListBox } from '@heroui/react/list-box';
import { Modal as HeroModal } from '@heroui/react/modal';
import { Select } from '@heroui/react/select';
import { TextArea as HeroTextArea } from '@heroui/react/textarea';
import htm from 'htm';

export function parseInlineStyle(style) {
  if (typeof style !== 'string') return style;
  const result = {};
  for (const rule of style.split(';')) {
    const splitAt = rule.indexOf(':');
    if (splitAt < 0) continue;
    const rawName = rule.slice(0, splitAt).trim();
    const value = rule.slice(splitAt + 1).trim();
    if (!rawName || !value) continue;
    const name = rawName.startsWith('--')
      ? rawName
      : rawName.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    result[name] = value;
  }
  return result;
}

export function reactElement(type, props, ...children) {
  const mapped = { ...(props || {}) };
  if (Object.hasOwn(mapped, 'class')) {
    mapped.className = mapped.class;
    delete mapped.class;
  }
  if (Object.hasOwn(mapped, 'autofocus')) {
    mapped.autoFocus = mapped.autofocus;
    delete mapped.autofocus;
  }
  if (Object.hasOwn(mapped, 'spellcheck')) {
    mapped.spellCheck = mapped.spellcheck;
    delete mapped.spellcheck;
  }
  if (typeof mapped.style === 'string') mapped.style = parseInlineStyle(mapped.style);
  return createElement(type, mapped, ...children);
}

export const html = htm.bind(reactElement);

export function Button({ className = '', onClick, onPress, disabled, isDisabled, variant, size = 'sm', ...props }) {
  const classes = String(className);
  const resolvedVariant = variant || (
    classes.includes('danger') ? 'danger' :
      classes.includes('active') ? 'primary' :
        /project-item|tree-row|tree-folder/.test(classes) ? 'ghost' : 'secondary'
  );
  return createElement(HeroButton, {
    ...props,
    className: `action-button ${classes}`.trim(),
    variant: resolvedVariant,
    size,
    isDisabled: isDisabled ?? disabled,
    onPress: onPress ?? onClick,
  });
}

export function TextInput({ className = '', onInput, onChange, variant = 'secondary', ...props }) {
  return createElement(HeroInput, {
    ...props,
    className: `atlas-input ${className}`.trim(),
    variant,
    onChange: onChange ?? onInput,
  });
}

export function TextArea({ className = '', onInput, onChange, variant = 'secondary', ...props }) {
  return createElement(HeroTextArea, {
    ...props,
    className: `atlas-textarea ${className}`.trim(),
    variant,
    onChange: onChange ?? onInput,
  });
}

export function SelectField({ value, onChange, options, className = '', style, ariaLabel }) {
  const selectedValue = value === '' || value === null || value === undefined ? '__empty__' : String(value);
  return html`
    <${Select}
      className=${className}
      style=${style}
      value=${selectedValue}
      aria-label=${ariaLabel}
      onChange=${next => onChange?.(next === '__empty__' ? '' : String(next))}
    >
      <${Select.Trigger}>
        <${Select.Value} />
        <${Select.Indicator} />
      </${Select.Trigger}>
      <${Select.Popover}>
        <${ListBox}>
          ${(options || []).map(option => html`
            <${ListBox.Item}
              key=${option.value}
              id=${option.value === '' ? '__empty__' : String(option.value)}
              textValue=${option.label}
            >
              ${option.label}
              <${ListBox.ItemIndicator} />
            </${ListBox.Item}>
          `)}
        </${ListBox}>
      </${Select.Popover}>
    </${Select}>
  `;
}

export function TreeView({ nodes, activeDoc, collapsed, toggleFolder, onSelect, onNewInFolder, onRename, onDelete, readOnly = false }) {
  return html`<div>
    ${(nodes || []).map(node =>
      node.type === 'folder'
        ? html`<div key=${node.path}>
            <div class="tree-folder">
              <${Button}
                className="tree-node-trigger"
                onClick=${() => toggleFolder(node.path)}
              >
                <span style="font-size:10px;opacity:0.7">${collapsed?.[node.path] ? '▸' : '▾'}</span>
                <span>📁</span>
                <span class="tree-label">${node.name}</span>
              </${Button}>
              ${!readOnly && html`<span class="item-actions">
                <${Button} className="tree-item-action" title="New file in folder" onClick=${() => onNewInFolder(node.path)}>+</${Button}>
              </span>`}
            </div>
            ${!collapsed?.[node.path] &&
            html`<div class="tree-group">
              <${TreeView}
                nodes=${node.children}
                activeDoc=${activeDoc}
                collapsed=${collapsed}
                toggleFolder=${toggleFolder}
                onSelect=${onSelect}
                onNewInFolder=${onNewInFolder}
                onRename=${onRename}
                onDelete=${onDelete}
                readOnly=${readOnly}
              />
            </div>`}
          </div>`
        : html`<div key=${node.path} class=${'tree-file' + (activeDoc === node.path ? ' selected' : '')}>
            <${Button}
              className="tree-node-trigger"
              onClick=${() => onSelect(node.path)}
            >
              <span>📄</span>
              <span class="tree-label">${node.name}</span>
            </${Button}>
            ${!readOnly && html`<span class="item-actions">
              <${Button} className="tree-item-action" title="Rename / Move" onClick=${() => onRename(node.path)}>✎</${Button}>
              <${Button} className="tree-item-action danger" title="Delete" onClick=${() => onDelete(node.path)}>✕</${Button}>
            </span>`}
          </div>`
    )}
  </div>`;
}

export const Card = HeroCard;
export const Modal = HeroModal;
export const Checkbox = HeroCheckbox;
