<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  type SelectOption = { value: string; label: string };
  export let value = '';
  export let label = '';
  export let options: SelectOption[] = [];
  export let placeholder = '';

  const dispatch = createEventDispatcher<{ value: string }>();
  let open = false;
  let root: HTMLDivElement;
  let activeIndex = 0;
  const listboxId = 'select-options-' + label.length;

  $: selected = options.find((option) => option.value === value);
  $: if (selected) activeIndex = Math.max(0, options.indexOf(selected));

  function choose(option: SelectOption) {
    value = option.value;
    open = false;
    dispatch('value', value);
  }

  function toggle() {
    open = !open;
    if (open && selected) activeIndex = options.indexOf(selected);
  }

  function handlePointerDown(event: PointerEvent) {
    if (root && !root.contains(event.target as Node)) open = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!root?.contains(event.target as Node)) return;
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      toggle();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(options.length - 1, activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (options[activeIndex]) choose(options[activeIndex]);
    }
  }

  onMount(() => {
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div class="select-menu" bind:this={root}>
  <button
    class="select-trigger"
    type="button"
    role="combobox"
    aria-label={label}
    aria-haspopup="listbox"
    aria-controls={listboxId}
    aria-expanded={open}
    on:click={toggle}
  >
    <span>{selected?.label ?? placeholder}</span>
    <span class="select-chevron" aria-hidden="true">⌄</span>
  </button>

  {#if open}
    <div class="select-popover" id={listboxId} role="listbox" aria-label={label}>
      {#each options as option, index}
        <button
          class:selected={option.value === value}
          class:active={index === activeIndex}
          class="select-option"
          type="button"
          role="option"
          aria-selected={option.value === value}
          on:click={() => choose(option)}
        >
          <span>{option.label}</span>
          {#if option.value === value}<span class="select-check" aria-hidden="true">✓</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .select-menu { position:relative; width:100%; }
  .select-trigger { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; min-height:43px; border:1px solid var(--line); border-radius:8px; padding:10px 12px; background:var(--surface); color:var(--ink); text-align:left; outline:0; transition:border-color .18s ease, box-shadow .18s ease; }
  .select-trigger:hover, .select-trigger[aria-expanded="true"] { border-color:var(--accent); }
  .select-trigger[aria-expanded="true"] { box-shadow:0 0 0 3px rgba(7,143,131,.12); }
  .select-chevron { color:var(--ink-muted); font-size:1rem; line-height:1; transform:translateY(-2px); }
  .select-popover { position:absolute; top:calc(100% + 6px); right:0; left:0; z-index:30; overflow:hidden; border:1px solid var(--line-strong); border-radius:8px; padding:5px; background:var(--surface); box-shadow:var(--shadow-lg); }
  .select-option { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; border:0; border-radius:5px; padding:9px 10px; background:transparent; color:var(--ink-soft); text-align:left; font-size:.84rem; }
  .select-option:hover, .select-option.active { background:var(--surface-tint); color:var(--ink); }
  .select-option.selected { color:var(--accent-strong); font-weight:700; }
  .select-check { color:var(--accent); font-weight:800; }
</style>