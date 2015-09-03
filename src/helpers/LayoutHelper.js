import {
  CHILD_ABOVE,
  CHILD_BELOW,
  CHILD_LEFT,
  CHILD_RIGHT,
  ROW,
  COL
} from '../constants/BlenderLayoutConstants';

import {List} from 'immutable';
import {Pane} from '../reducers/LayoutReducer';

function getNextId(state) {
  return (
    state
      .get('panes')
      .map(pane => parseInt(pane.id))
      .max() + 1
  ) + '';
}

function wrapPane(state, id) {
  let pane = state.panes.get(id);
  let parent = state.panes.get(pane.parentId);
  let parentId = pane.parentId;
  let groupId = getNextId(state);
  let group = new Pane({
    id: groupId,
    isGroup: true,
    childIds: List([id]),
    parentId: pane.parentId,
    splitRatio: pane.splitRatio
  });
  pane = pane.set('parentId', groupId);
  state = state.setIn(['panes', id], pane);
  state = state.setIn(['panes', groupId], group);
  if (parent) {
    let childIds = parent.childIds;
    childIds = childIds.set(childIds.indexOf(id), groupId);
    console.log('childIds', childIds.toJS());
    state = state.setIn(['panes', parentId, 'childIds'], childIds);
  }
  console.log('mo', state.toJS());
  return {state, group};
}

function getDirection(splitType) {
  if (splitType === CHILD_ABOVE || splitType === CHILD_BELOW) return COL;
  if (splitType === CHILD_LEFT || splitType === CHILD_RIGHT) return ROW;
}

function getOffset(splitType) {
  if (splitType === CHILD_ABOVE || splitType === CHILD_LEFT) return 0;
  if (splitType === CHILD_BELOW || splitType === CHILD_RIGHT) return 1;
}

export function split(state, {id, splitType}) {
  let pane = state.panes.get(id);
  let parent = state.panes.get(pane.parentId);
  let direction = getDirection(splitType);
  let isRoot = id === state.rootId;

  if (!parent || (parent.direction !== direction)) {
    let out = wrapPane(state, id);
    parent = out.group;
    parent = parent.set('direction', direction);
    console.log(id + '', isRoot);
    state = out.state;
    if (isRoot) {
      state = state.set('rootId', parent.id);
    }
    pane = pane.set('splitRatio', 1);
  }
  let childIds = parent.childIds;
  let index = childIds.indexOf(id);
  let newPane = new Pane({
    id: getNextId(state),
    parentId: parent.get('id'),
    splitRatio: 0.2
  });
  let offset = getOffset(splitType);
  console.log('parent', parent.toJS());
  childIds = childIds.splice(index + offset, 0, newPane.id);
  parent = parent.set('childIds', childIds);
  state = state.setIn(['panes', parent.id], parent);
  state = state.setIn(['panes', newPane.id], newPane);
  state = state.setIn(['panes', pane.id, 'splitRatio'], pane.splitRatio * 0.75);
  state = state.setIn(['panes', newPane.id, 'splitRatio'], pane.splitRatio * 0.25);
  console.log(state.toJS());
  return state;
}

function removePane(state, id) {
  //splice pane out of parents childIds
  let pane = state.panes.get(id);
  let parent = state.panes.get(pane.parentId);
  if (!parent) return state;
  let childIds = parent.childIds;
  let index = childIds.indexOf(id);
  let panes = state.panes;
  childIds = childIds.splice(index, 1);
  parent = parent.set('childIds', childIds);
  panes = panes.set(parent.id, parent);
  if (childIds.size === 1) {
    let remainingPane = panes.get(childIds.get(0));
    if (parent.id === state.rootId) {
      state = state.set('rootId', remainingPane.id);
      remainingPane = remainingPane.set('parentId', undefined);
    } else {
      let grandparentId = parent.parentId;
      let grandparent = panes.get(grandparentId);
      let grandchildIds = grandparent.childIds;
      index = grandchildIds.indexOf(parent.id);
      grandchildIds = grandchildIds.set(index, remainingPane.id);
      grandparent = grandparent.set('childIds', grandchildIds);
      remainingPane = remainingPane.set('parentId', grandparentId);
      panes = panes.set(grandparent.id, grandparent);
    }
    panes = panes.delete(parent.id);
    remainingPane = remainingPane.set('direction', undefined);
    panes = panes.set(remainingPane.id, remainingPane);
  }
  panes = panes.delete(id);
  state = state.set('panes', panes);
  return state;
}

export function join(state, {retainId, removeId}) {
  let remove = state.panes.get(removeId);
  if (remove.isGroup) {
    console.warn('cannot replace group');
    return state;
  }
  let retain = state.panes.get(retainId);
  let parent = state.panes.get(retain.parentId);
  let siblings = parent.childIds;
  let pos = [retainId, removeId].map(id => siblings.indexOf(id));
  if (
    pos[1] === -1 ||
    pos[0] === -1 ||
    !(pos[0] + 1 === pos[1] || pos[0] - 1 === pos[1])
  ) {
    console.warn('pane must be adjacent to join');
    return state;
  }
  state = removePane(state, removeId);
  let splitRatio = remove.splitRatio + retain.splitRatio;
  state = state.setIn(['panes', retain.id, 'splitRatio'], splitRatio);
  return state;
}

export function setSplitRatio(state, action) {
  const {splitRatio, id} = action;

  state = state.setIn(
    ['panes', id, 'splitRatio'],
    splitRatio
  );
  return state;
}

export function setSize(state, {width, height}) {
  return state.set('width', width).set('height', height);
}

export function setMode(state, action) {
  const {mode, id, splitStartX, splitStartY} = action;
  return state
    .set('mode', mode)
    .set('splitJoinId', id)
    .set('splitStartX', splitStartX)
    .set('splitStartY', splitStartY);
}

export function setBlock(state, action) {
  const {displayBlock} = action;
  return state
    .set('displayBlock', displayBlock);
}

export function flatten(state, rootId, {width, height, left = 0, top = 0}) {
  let rootPane = state.panes.get(rootId).toJS();
  let paneMap = {};
  let dividerMap = {};
  const dividerSize = state.dividerSize;

  rootPane.width = width;
  rootPane.height = height;
  rootPane.left = left;
  rootPane.top = top;

  let flattenChildren = (parent) => {
    let x = parent.left;
    let y = parent.top;
    let child;
    let dividerOffset;
    let hasDivider = false;
    let beforePaneId;
    let divider;


    parent.childIds.forEach((childId, i)=> {
      child = state.panes.get(childId).toJS();
      hasDivider = i !== 0;
      dividerOffset = 0;
      if (hasDivider) {
        dividerOffset = dividerSize;
        divider = {
          left: x,
          top: y,
          beforePaneId: beforePaneId,
          afterPaneId: child.id
        };
      }

      if (parent.direction === ROW) {
        if (hasDivider) {
          divider.width = dividerSize;
          divider.height = parent.height;
          x += dividerSize;
          dividerMap[beforePaneId + 'n' + child.id] = divider;
        }
        child.width = parent.width * child.splitRatio - dividerOffset;
        child.height = parent.height;
        child.left = x;
        child.top = y;
        x += child.width;
      } else if (parent.direction === COL) {
        if (hasDivider) {
          divider.width = parent.width;
          divider.height = dividerSize;
          y += dividerSize;
          dividerMap[beforePaneId + 'n' + child.id] = divider;
        }
        child.width = parent.width;
        child.height = parent.height * child.splitRatio - dividerOffset;
        child.left = x;
        child.top = y;
        y += child.height;
      }
      beforePaneId = child.id;
      if (child.isGroup) {
        flattenChildren(child);
      } else {
        paneMap[childId] = child;
      }
    });
  };

  flattenChildren(rootPane);

  return {dividerMap, paneMap};
}
