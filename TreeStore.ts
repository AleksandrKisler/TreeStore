export type ItemID = string | number

export interface TreeItem {
  readonly id: ItemID
  readonly parent?: ItemID | null | undefined
}

export type TreeStoreErrorCode =
  | 'INVALID_ITEM'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'INVALID_PARENT'
  | 'PARENT_NOT_FOUND'
  | 'SELF_PARENT'
  | 'CYCLE' // это на всякий случай если связи образуют замкнутую цепочку.

export interface TreeStoreErrorDetails {
  readonly index?: number
  readonly id?: unknown
  readonly parent?: unknown
  readonly firstIndex?: number
  readonly path?: readonly ItemID[]
}

// Если будет ошибка в входных данных то мы хотя бы поймем какая.
export class TreeStoreError extends Error {
  readonly code: TreeStoreErrorCode
  readonly details: TreeStoreErrorDetails

  constructor(code: TreeStoreErrorCode, message: string, details: TreeStoreErrorDetails) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

interface TreeNode<T> {
  readonly id: ItemID
  readonly index: number
  readonly item: T
  parent: TreeNode<T> | null
  readonly children: T[]
}

const EMPTY: readonly never[] = Object.freeze([])

export class TreeStore<T extends TreeItem = TreeItem> {
  readonly #items: readonly T[]
  readonly #nodes: Map<ItemID, TreeNode<T>>

  /**
   * @params items - входной массив элкментов в любом порядке.
   * @throws {TypeError} - если вмсто массива нам пытаюься передать что-то другое.
   * @throws {TreeStoreError} - если массив это троянский конь.
   */

  constructor(items: readonly T[]) {
    if (!Array.isArray(items)) {
      throw new TypeError(`Страрина давай по новой, это не массив, смотри в консоль что ты передал ${describe(items)}`);
    }

    const snapshot: readonly T[] = Object.freeze([...items]);
    const nodes = indexItems(snapshot);
    linkParents(nodes);
    assertAcyclic(nodes);
    // Заморозка поверхностная: защищаем массивы детей, но не объекты внутри них.
    for (const node of nodes.values()) {
      Object.freeze(node.children);
    }

    this.#items = snapshot;
    this.#nodes = nodes;
  }

  getAll(): readonly T[] {
    return this.#items;
  }

  getItem(id: ItemID): T | undefined {
    return this.#nodes.get(checkID(id, 'getItem'))?.item;
  }

  getChildren(id: ItemID): readonly T[] {
    return this.#nodes.get(checkID(id, 'getChildren'))?.children ?? EMPTY;
  }

}

// наши родители и дети в полном хаосе им нужно дать намера что бы найти друг друга
function indexItems<T extends TreeItem>(items: readonly T[]): Map<ItemID, TreeNode<T>> {
  const nodes = new Map<ItemID, TreeNode<T>>()

  for (let index = 0; index < items.length; index++) {
    const item: unknown = items[index]
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new TreeStoreError(
        'INVALID_ITEM',
        `items[${index}] я ждал объект, а вот это что? ${describe(item)}`,
        {index},
      );
    }

    const id: unknown = (item as TreeItem).id;
    if (!isItemID(id)) {
      throw new TreeStoreError(
        'INVALID_ID',
        `items[${index}].id если это не чило и не строка, забирай свой ${describe(id)} и иди гуляй)`,
        {index, id},
      );
    }

    const existing = nodes.get(id);
    if (existing !== undefined) {
      throw new TreeStoreError(
        'DUPLICATE_ID',
        `я перепутал кто есть кто ${describe(id)}: один из вас дмитрий items[${existing.index}] лжедмитрий [${index}]`,
        {index, id, firstIndex: existing.index},
      );
    }

    nodes.set(id, {id, index, item: item as T, parent: null, children: []});
  }
  return nodes;
}

// в роддоме дейтей перемешали и мы помогаем им найти родителей, у кого нет родителей тот сирота(
function linkParents<T extends TreeItem>(nodes: ReadonlyMap<ItemID, TreeNode<T>>): void {
  for (const node of nodes.values()) {
    const parent: unknown = node.item.parent;
    if (parent === null || parent === undefined) {
      continue;
    }

    if (!isItemID(parent)) {
      throw new TreeStoreError(
        'INVALID_PARENT',
        `items[${node.index}].parent опять какая то мина в данных вместо родителя ${describe(parent)}`,
        { index: node.index, id: node.id, parent },
      );
    }

    if (parent === node.id) {
      throw new TreeStoreError(
        'SELF_PARENT',
        `items[${node.index}] (id ${describe(node.id)}) есть 3 апельстна и 4 человека дед отец сын`,
        { index: node.index, id: node.id, parent },
      );
    }

    const parentNode = nodes.get(parent);
    if (parentNode === undefined) {
      throw new TreeStoreError(
        'PARENT_NOT_FOUND',
        `items[${node.index}] (у ${describe(node.id)}) сирота(( ${describe(parent)}`,
        { index: node.index, id: node.id, parent },
      );
    }

    node.parent = parentNode;
    parentNode.children.push(node.item);
  }
}


// тут на всякий случай мы верефицируем узлы вдург бордак
function assertAcyclic<T extends TreeItem>(nodes: ReadonlyMap<ItemID, TreeNode<T>>): void {
  // ON_PATH — находится в текущей цепочке обхода;  VERIFIED — уже доказано, что цепочка от этого узла не содержит циклов.
  const ON_PATH = 1;
  const VERIFIED = 2;
  const state = new Map<TreeNode<T>, typeof ON_PATH | typeof VERIFIED>();

  for (const start of nodes.values()) {
    if (state.has(start)) {
      continue;
    }

    const path: TreeNode<T>[] = [];
    let node: TreeNode<T> | null = start;
    while (node !== null) {
      const mark = state.get(node);
      if (mark === VERIFIED) {
        break;
      }
      if (mark === ON_PATH) {
        const loop = path.slice(path.indexOf(node)).map((n) => n.id);
        loop.push(node.id);
        throw new TreeStoreError(
          'CYCLE',
          `Собака бегает за хвостом и непонимает где голова: ${loop.map(describe).join(' -> ')}`,
          { index: node.index, id: node.id, path: loop },
        );
      }
      state.set(node, ON_PATH);
      path.push(node);
      node = node.parent;
    }

    for (const visited of path) {
      state.set(visited, VERIFIED);
    }
  }
}

function isItemID(value: unknown): value is ItemID {
  return (
    (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}


function checkID(id: unknown, method: string): ItemID {
  if (!isItemID(id)) {
    throw new TypeError(
      'мы вроде бы договорились о типе ID в TreeStore, а ты опять закинул что-то не то в метод(((',
    );
  }
  return id
}


// заботимся о том что бы в сообщениях об ошибках было понятно что за данные мы получили.
function describe(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return `${value}n`;
    case 'function':
      return 'function';
    case 'object':
      return value === null ? 'null' : Array.isArray(value) ? 'array' : 'object';
    default:
      return String(value);
  }
}
