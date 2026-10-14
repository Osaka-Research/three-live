// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Dependency-free `userData.interactivity` -> `KHR_interactivity`
 * compiler. Shared by `three-convert.ts` (web GLB export) and the embedded
 * Rust compiler engine (`ENABLE_SERVER_EXTRACT`) so web and native `.glb`
 * outputs carry byte-identical behavior graphs.
 */

/**
 * Compiles high-level `userData.interactivity` authoring traits on Three.js
 * nodes (or a raw `scene.userData.interactivity` graph) into a standard
 * Khronos `KHR_interactivity` extension payload.
 */
export function compileInteractivityGraph(
  // tslint:disable-next-line:no-any
  gltfNodes: readonly any[],
  // tslint:disable-next-line:no-any
  gltfMeshes: readonly any[],
  // tslint:disable-next-line:no-any
  sceneUserData?: Record<string, any>,
  // tslint:disable-next-line:no-any
): Record<string, any> | null {
  const declarations: Array<{op: string}> = [];
  const declMap = new Map<string, number>();
  // tslint:disable-next-line:no-any
  const graphNodes: any[] = [];
  // tslint:disable-next-line:no-any
  const variables: any[] = [];
  // tslint:disable-next-line:no-any
  const events: any[] = [];
  const eventMap = new Map<string, number>();

  const ensureDecl = (op: string): number => {
    let idx = declMap.get(op);
    if (idx === undefined) {
      idx = declarations.length;
      declarations.push({op});
      declMap.set(op, idx);
    }
    return idx;
  };

  const ensureEvent = (id: string): number => {
    let idx = eventMap.get(id);
    if (idx === undefined) {
      idx = events.length;
      events.push({id});
      eventMap.set(id, idx);
    }
    return idx;
  };

  // tslint:disable-next-line:no-any
  const addNode = (op: string, spec: Record<string, any> = {}): number =>
    graphNodes.push({declaration: ensureDecl(op), ...spec}) - 1;
  // tslint:disable-next-line:no-any
  const addVar = (id: string, type: string, value: any): number =>
    variables.push({id, type, value}) - 1;
  const link = (node: number) => ({node, socket: 'value'});

  const rawExt =
    sceneUserData?.interactivity ??
    sceneUserData?.gltfExtensions?.KHR_interactivity;
  if (rawExt && typeof rawExt === 'object') {
    const rawGraph = Array.isArray(rawExt.graphs)
      ? rawExt.graphs[rawExt.graph ?? 0]
      : rawExt;
    if (rawGraph && Array.isArray(rawGraph.nodes)) {
      const rawDecls = Array.isArray(rawGraph.declarations)
        ? rawGraph.declarations
        : [];
      for (const d of rawDecls) {
        if (d?.op) ensureDecl(d.op);
      }
      if (Array.isArray(rawGraph.variables)) variables.push(...rawGraph.variables);
      for (const ev of rawGraph.events || []) {
        if (ev?.id) ensureEvent(ev.id);
      }
      for (const rn of rawGraph.nodes) {
        if (!rn || typeof rn !== 'object') continue;
        const opStr =
          rn.op ||
          (typeof rn.declaration === 'number'
            ? rawDecls[rn.declaration]?.op
            : '');
        graphNodes.push(
          opStr ? {...rn, declaration: ensureDecl(opStr)} : {...rn},
        );
      }
    }
  }

  const resolvePtr = (nIdx: number, mIdx: number, prop = 'translation'): string =>
    prop === 'baseColorFactor' ||
    prop === 'metallicFactor' ||
    prop === 'roughnessFactor'
      ? `/materials/${Math.max(0, mIdx)}/pbrMetallicRoughness/${prop}`
      : prop === 'emissiveFactor' || prop === 'alphaCutoff'
        ? `/materials/${Math.max(0, mIdx)}/${prop}`
        : prop === 'visible'
          ? `/nodes/${nIdx}/extensions/KHR_node_visibility/visible`
          : `/nodes/${nIdx}/${prop}`;

  // `target: '<node name>'` is portable across exporters; numeric
  // `targetNode` / raw pointers use this exporter's node numbering.
  const nodeByName = new Map<string, number>();
  gltfNodes.forEach((n, i) => {
    if (typeof n?.name === 'string' && !nodeByName.has(n.name)) nodeByName.set(n.name, i);
  });
  // tslint:disable-next-line:no-any
  const targetOf = (act: any, self: number): number =>
    typeof act.target === 'string' && nodeByName.has(act.target)
      ? nodeByName.get(act.target)!
      : typeof act.targetNode === 'number'
        ? act.targetNode
        : self;
  // tslint:disable-next-line:no-any
  const matOf = (n: number): number => {
    const g = gltfNodes[n];
    return (typeof g?.mesh === 'number' ? gltfMeshes[g.mesh]?.primitives?.[0]?.material : 0) ?? 0;
  };

  for (let nodeIdx = 0; nodeIdx < gltfNodes.length; nodeIdx++) {
    const gNode = gltfNodes[nodeIdx];
    const inter = gNode?.extras?.interactivity;
    if (!inter || typeof inter !== 'object') continue;

    const matIdx =
      (typeof gNode.mesh === 'number'
        ? gltfMeshes[gNode.mesh]?.primitives?.[0]?.material
        : 0) ?? 0;

    // tslint:disable-next-line:no-any
    const compileChain = (input: any): number | null => {
      const list = Array.isArray(input) ? input : [input];
      const entries: number[] = [];

      for (let aIdx = 0; aIdx < list.length; aIdx++) {
        const act = list[aIdx];
        if (!act || typeof act !== 'object') continue;
        const kind = act.action || 'interpolate';
        const dur = typeof act.duration === 'number' ? act.duration : 0.35;

        if (kind === 'toggleTransform') {
          const prop =
            act.property === 'rotation' || act.property === 'scale'
              ? act.property
              : 'translation';
          const def =
            prop === 'rotation'
              ? gNode.rotation || [0, 0, 0, 1]
              : prop === 'scale'
                ? gNode.scale || [1, 1, 1]
                : gNode.translation || [0, 0, 0];
          const ptr = `/nodes/${nodeIdx}/${prop}`;
          const varIdx = addVar(`__toggle_${nodeIdx}_${aIdx}`, 'bool', false);
          const getIdx = addNode('variable/get', {configuration: {variable: varIdx}});
          const notIdx = addNode('math/not', {values: {a: link(getIdx)}});
          const setIdx = addNode('variable/set', {
            configuration: {variable: varIdx},
            values: {value: link(notIdx)},
          });
          const toIdx = addNode('pointer/interpolate', {
            configuration: {pointer: ptr},
            values: {
              value: {value: Array.isArray(act.to) ? act.to : def},
              duration: {value: dur},
            },
          });
          const fromIdx = addNode('pointer/interpolate', {
            configuration: {pointer: ptr},
            values: {
              value: {value: Array.isArray(act.from) ? act.from : def},
              duration: {value: dur},
            },
          });
          graphNodes[setIdx].flows = {
            out: {
              node: addNode('flow/branch', {
                values: {condition: link(getIdx)},
                flows: {true: {node: toIdx}, false: {node: fromIdx}},
              }),
            },
          };
          entries.push(setIdx);
        } else if (kind === 'interpolate') {
          const toVal = act.to ?? act.value;
          if (toVal === undefined) continue;
          // tslint:disable-next-line:no-any
          const values: Record<string, any> = {
            value: {value: toVal},
            duration: {value: dur},
          };
          if (act.from !== undefined) values.from = {value: act.from};
          entries.push(
            addNode('pointer/interpolate', {
              configuration: {
                pointer:
                  typeof act.pointer === 'string'
                    ? act.pointer
                    : resolvePtr(targetOf(act, nodeIdx), matOf(targetOf(act, nodeIdx)), act.property),
              },
              values,
            }),
          );
        } else if (kind === 'setProperty') {
          if (act.value === undefined) continue;
          entries.push(
            addNode('pointer/set', {
              configuration: {
                pointer:
                  typeof act.pointer === 'string'
                    ? act.pointer
                    : resolvePtr(targetOf(act, nodeIdx), matOf(targetOf(act, nodeIdx)), act.property),
              },
              values: {value: {value: act.value}},
            }),
          );
        } else if (kind === 'toggleVisibility') {
          const tNode =
            targetOf(act, nodeIdx);
          const varIdx = addVar(`__vis_${tNode}_${aIdx}`, 'bool', true);
          const getIdx = addNode('variable/get', {configuration: {variable: varIdx}});
          const notIdx = addNode('math/not', {values: {a: link(getIdx)}});
          const setVarIdx = addNode('variable/set', {
            configuration: {variable: varIdx},
            values: {value: link(notIdx)},
          });
          graphNodes[setVarIdx].flows = {
            out: {
              node: addNode('pointer/set', {
                configuration: {
                  pointer: `/nodes/${tNode}/extensions/KHR_node_visibility/visible`,
                },
                values: {value: link(getIdx)},
              }),
            },
          };
          entries.push(setVarIdx);
        } else if (
          kind === 'cycleMaterialColor' &&
          Array.isArray(act.colors) &&
          act.colors.length > 0
        ) {
          const cDur = typeof act.duration === 'number' ? act.duration : 0.25;
          const ptr = `/materials/${Math.max(0, matIdx)}/pbrMetallicRoughness/baseColorFactor`;
          const varIdx = addVar(`__color_idx_${nodeIdx}_${aIdx}`, 'int', 0);
          const getIdx = addNode('variable/get', {configuration: {variable: varIdx}});
          const addIdx = addNode('math/add', {
            values: {a: link(getIdx), b: {value: 1}},
          });
          const remIdx = addNode('math/rem', {
            values: {a: link(addIdx), b: {value: act.colors.length}},
          });
          const setIdx = addNode('variable/set', {
            configuration: {variable: varIdx},
            values: {value: link(remIdx)},
          });
          const flows: Record<string, {node: number}> = {};
          for (let cIdx = 0; cIdx < act.colors.length; cIdx++) {
            const c = act.colors[cIdx];
            const rgba =
              Array.isArray(c) && c.length >= 3
                ? [c[0], c[1], c[2], c[3] ?? 1]
                : [1, 1, 1, 1];
            flows[String(cIdx)] = {
              node:
                cDur > 0
                  ? addNode('pointer/interpolate', {
                      configuration: {pointer: ptr},
                      values: {value: {value: rgba}, duration: {value: cDur}},
                    })
                  : addNode('pointer/set', {
                      configuration: {pointer: ptr},
                      values: {value: {value: rgba}},
                    }),
            };
          }
          graphNodes[setIdx].flows = {
            out: {
              node: addNode('flow/switch', {
                values: {selection: link(getIdx)},
                flows,
              }),
            },
          };
          entries.push(setIdx);
        } else if (kind === 'playAnimation') {
          entries.push(
            addNode('animation/start', {
              configuration: {animation: act.animation ?? act.clip ?? 0},
            }),
          );
        } else if (kind === 'stopAnimation') {
          entries.push(addNode('animation/stop'));
        } else if (kind === 'sendEvent') {
          // tslint:disable-next-line:no-any
          const values: Record<string, any> = {};
          for (const [k, v] of Object.entries(act.values || {})) {
            values[k] = {value: v};
          }
          entries.push(
            addNode('event/send', {
              configuration: {
                event: ensureEvent(String(act.event ?? act.id ?? 'custom')),
              },
              values,
            }),
          );
        }
      }

      if (!entries.length) return null;
      if (entries.length === 1) return entries[0];
      const flows: Record<string, {node: number}> = {};
      entries.forEach((n, i) => {
        flows[String(i)] = {node: n};
      });
      return addNode('flow/sequence', {flows});
    };

    const bindTrigger = (op: string, actions: unknown, cfg?: Record<string, unknown>) => {
      const target = compileChain(actions);
      if (target !== null) {
        addNode(op, {
          ...(cfg ? {configuration: cfg} : {}),
          flows: {out: {node: target}},
        });
      }
    };

    if (inter.onSelect) bindTrigger('pointer/onSelect', inter.onSelect, {nodeIndex: nodeIdx});
    if (inter.onHoverIn) bindTrigger('pointer/onHoverIn', inter.onHoverIn, {nodeIndex: nodeIdx});
    if (inter.onHoverOut) bindTrigger('pointer/onHoverOut', inter.onHoverOut, {nodeIndex: nodeIdx});
    if (inter.onStart) bindTrigger('event/onStart', inter.onStart);
    if (inter.onReceive && typeof inter.onReceive === 'object') {
      for (const [evName, actions] of Object.entries(inter.onReceive)) {
        bindTrigger('event/receive', actions, {event: ensureEvent(evName)});
      }
    }
  }

  return graphNodes.length
    ? {graphs: [{declarations, nodes: graphNodes, variables, events}], graph: 0}
    : null;
}
