(function () {
  'use strict';

  const DEFAULT_JSON = '632251_271879959b2c9dbf006e4b6bcc3f15a3_1.json';
  const INDENT_UNIT = '    '; // 4 spaces for clearer child indentation
  const INDENT_STEP_PX = 16; // visual indent step in pixels for details offset
  const LEADING_ICON_AREA_PX = 32; // caret + icon + bullet visual width

  const $ = (sel) => document.querySelector(sel);
  const treeEl = $('#tree');
  const statusEl = $('#status');
  const fileInput = $('#fileInput');
  const loadDefaultBtn = $('#loadDefaultBtn');
  const expandAllBtn = $('#expandAll');
  const collapseAllBtn = $('#collapseAll');
  const printStructureBtn = $('#printStructure');
  const printJSONBtn = $('#printJSON');
  const searchInput = $('#search');
  const clearSearchBtn = $('#clearSearch');

  function setStatus(message) { statusEl.textContent = message || ''; }

  function normalizeRoot(data) {
    if (data && typeof data === 'object' && data.structure && typeof data.structure === 'object') {
      return data.structure;
    }
    return data;
  }

  function getNodeLabel(node) {
    const id = node.id || node.name || '(no-id)';
    const type = node.componentType || node.type || '';
    return { id, type };
  }

  function createLeaf(node, depth) {
    return createObjectViewer(node, depth, false);
  }

  function createBranch(node, depth) {
    return createObjectViewer(node, depth, true);
  }

  function createObjectViewer(node, depth, hasNestedChildren) {
    const { id, type } = getNodeLabel(node);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    
    const indent = document.createElement('span');
    indent.className = 'indent';
    indent.textContent = INDENT_UNIT.repeat(depth);
    summary.appendChild(indent);
    
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = '▸';
    summary.appendChild(caret);
    
    const icon = document.createElement('span');
    icon.className = hasNestedChildren ? 'icon folder' : 'icon file';
    summary.appendChild(icon);
    
    const bullet = document.createElement('span');
    bullet.className = 'bullet';
    summary.appendChild(bullet);
    
    const textContainer = document.createElement('div');
    textContainer.className = 'text-container';
    const label = document.createElement('div');
    label.className = 'label';
    // If namingQuery resolves and has a name, append it to the title
    let displayId = id;
    try {
      if (node && node.namingQuery) {
        const resolvedNaming = resolveQueryValue('namingQuery', node.namingQuery);
        if (resolvedNaming && typeof resolvedNaming === 'object' && !Array.isArray(resolvedNaming) && typeof resolvedNaming.name === 'string' && resolvedNaming.name.trim()) {
          displayId = `${id} (${resolvedNaming.name})`;
          try { console.log('Applied naming to title:', id, '->', displayId); } catch (_) {}
        }
      }
    } catch (_) { /* ignore resolution errors for title */ }
    label.textContent = displayId;
    textContainer.appendChild(label);
    if (type) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = type;
      textContainer.appendChild(meta);
    }
    summary.appendChild(textContainer);
    
    // Get children first so we can use it for the badge
    const children = getChildren(node);
    
    // Add child count badge if there are children
    if (children.length > 0) {
      const totalCount = getDescendantCount(node);
      const count = document.createElement('span');
      count.className = 'badge';
      count.textContent = String(totalCount);
      count.title = `${totalCount} total descendants`;
      summary.appendChild(count);
    }
    
    const printBtn = document.createElement('button');
    printBtn.className = 'print-btn';
    printBtn.textContent = '🖨️';
    printBtn.title = 'Print this item to console';
    printBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log(`=== Object for ${id} ===`);
      console.log(node);
      console.log('=== End Object ===');
    });
    summary.appendChild(printBtn);
    
    details.appendChild(summary);
    
    // Add children directly to the details element (not in a separate section)
    if (children.length > 0) {
      // Sort children by their total descendant count (most to least)
      const sortedChildren = children.slice().sort((a, b) => {
        const aCount = getDescendantCount(a);
        const bCount = getDescendantCount(b);
        return bCount - aCount;
      });
      
      for (const child of sortedChildren) {
        const hasGrandChildren = hasChildren(child);
        details.appendChild(hasGrandChildren ? createBranch(child, depth + 1) : createLeaf(child, depth + 1));
      }
    }
    
    // Structure section (all other properties) - only if there are non-children properties
    const structureProps = Object.entries(node).filter(([key]) => key !== 'children' && key !== 'components');
    if (structureProps.length > 0) {
      const structureDetails = document.createElement('details');
      structureDetails.className = 'section-details structure-section';
      
      const structureSummary = document.createElement('summary');
      structureSummary.className = 'section-summary';
      
      // Apply indentation on the details element itself so the border shifts as well
      const leftOffsetPx = depth * INDENT_STEP_PX + LEADING_ICON_AREA_PX;
      structureDetails.style.marginLeft = `${leftOffsetPx}px`;
      
      const structureIcon = document.createElement('span');
      structureIcon.className = 'section-icon';
      structureIcon.textContent = '⚙️';
      structureSummary.appendChild(structureIcon);
      
      const structureText = document.createTextNode(` structure (${structureProps.length} properties)`);
      structureSummary.appendChild(structureText);
      
      structureDetails.appendChild(structureSummary);
      
      const structureContainer = document.createElement('div');
      structureContainer.className = 'structure section-content';
      
      for (const [key, value] of structureProps) {
        const propSection = document.createElement('div');
        propSection.className = 'property-section';
        
        const propKey = document.createElement('span');
        propKey.className = 'property-key';
        propKey.textContent = key + ':';
        propSection.appendChild(propKey);
        
        // Resolve query values if this is a query field
        const resolvedValue = key.endsWith('Query') ? resolveQueryValue(key, value) : value;
        const isResolved = resolvedValue !== value;
        
        if (resolvedValue === null || resolvedValue === undefined) {
          const propValue = document.createElement('span');
          propValue.className = 'property-value null';
          propValue.textContent = String(resolvedValue);
          if (isResolved) {
            propValue.title = `Original query: ${value}`;
          }
          propSection.appendChild(propValue);
        } else if (resolvedValue && typeof resolvedValue === 'object' && resolvedValue.__unresolved) {
          // Handle unresolved query
          const propValue = document.createElement('span');
          propValue.className = 'property-value null unresolved';
          propValue.textContent = `null (${resolvedValue.originalQuery})`;
          propValue.title = `Query not found in data map: ${resolvedValue.originalQuery}`;
          propSection.appendChild(propValue);
        } else if (typeof resolvedValue === 'object' && !Array.isArray(resolvedValue)) {
          // Object - make it expandable
          const objDetails = document.createElement('details');
          objDetails.className = 'property-object';
          
          const objSummary = document.createElement('summary');
          objSummary.className = 'property-value object-summary';
          objSummary.textContent = `{...} (${Object.keys(resolvedValue).length} properties)`;
          if (isResolved) {
            objSummary.textContent += ` [resolved from ${value}]`;
            objSummary.title = `Original query: ${value}`;
          }
          objDetails.appendChild(objSummary);
          
          const objContent = document.createElement('div');
          objContent.className = 'object-properties';
          
          for (const [objKey, objValue] of Object.entries(resolvedValue)) {
            const objProp = document.createElement('div');
            objProp.className = 'nested-property';
            
            const objPropKey = document.createElement('span');
            objPropKey.className = 'property-key nested';
            objPropKey.textContent = objKey + ':';
            objProp.appendChild(objPropKey);
            
            const objPropValue = document.createElement('span');
            objPropValue.className = 'property-value';
            objPropValue.textContent = typeof objValue === 'object' ? 
              (Array.isArray(objValue) ? `[Array(${objValue.length})]` : '{Object}') : 
              String(objValue);
            objProp.appendChild(objPropValue);
            
            objContent.appendChild(objProp);
          }
          
          objDetails.appendChild(objContent);
          propSection.appendChild(objDetails);
        } else if (Array.isArray(resolvedValue)) {
          // Array - show summary
          const propValue = document.createElement('span');
          propValue.className = 'property-value array';
          propValue.textContent = `[Array(${resolvedValue.length})]`;
          if (isResolved) {
            propValue.textContent += ` [resolved from ${value}]`;
            propValue.title = `Original query: ${value}`;
          }
          propSection.appendChild(propValue);
        } else {
          // Primitive value
          const propValue = document.createElement('span');
          propValue.className = `property-value ${typeof resolvedValue}`;
          propValue.textContent = String(resolvedValue);
          if (isResolved) {
            propValue.title = `Original query: ${value}`;
          }
          propSection.appendChild(propValue);
        }
        
        structureContainer.appendChild(propSection);
      }
      
      structureDetails.appendChild(structureContainer);
      details.appendChild(structureDetails);
    }
    
    return details;
  }

  function hasChildren(node) {
    const c1 = Array.isArray(node.children) && node.children.length > 0;
    const c2 = Array.isArray(node.components) && node.components.length > 0;
    return c1 || c2;
  }

  function getChildren(node) {
    if (Array.isArray(node.children)) return node.children;
    if (Array.isArray(node.components)) return node.components;
    return [];
  }

  function getDescendantCount(node) {
    const children = getChildren(node);
    let total = children.length;
    for (const child of children) {
      total += getDescendantCount(child);
    }
    return total;
  }

  function printNodeStructure(node, depth = 0) {
    const { id, type } = getNodeLabel(node);
    const children = getChildren(node);
    const indent = '  '.repeat(depth);
    const childCount = children.length;
    const totalCount = getDescendantCount(node);
    
    console.log(`${indent}${id} (${type}) [${childCount} children, ${totalCount} total]`);
    
    for (const child of children) {
      printNodeStructure(child, depth + 1);
    }
  }

  let currentRoot = null;
  let currentFullJSON = null;

  // Data map mappings for query resolution
  const DATA_MAP_MAPPINGS = {
    'dataQuery': 'document_data',
    'designQuery': 'design_data', 
    'behaviorsQuery': 'behaviors_data',
    'connectionQuery': 'connections_data',
    'themeQuery': 'theme_data',
    'layoutQuery': 'layout_data',
    'componentPropertiesQuery': 'component_properties',
    'mobileHintsQuery': 'mobile_hints',
    'atomicScopesQuery': 'atomicScopes',
    'classnamesQuery': 'classnames',
    'editorsettingsQuery': 'editorsettings',
    'fixerVersionsQuery': 'fixerVersions',
    'namingQuery': 'naming',
    'reactionsQuery': 'reactions',
    'slotsQuery': 'slots',
    'sourceQuery': 'source',
    'statesQuery': 'states',
    'themeConfigQuery': 'themeConfig',
    'transformationsQuery': 'transformations_data',
    'transitionsQuery': 'transitions_data',
    'triggersQuery': 'triggers',
    'variablesQuery': 'variables',
    'variantsQuery': 'variants_data'
  };

  function resolveQueryValue(key, value) {
    if (!currentFullJSON || typeof value !== 'string') return value;

    const dataMapKey = DATA_MAP_MAPPINGS[key];
    const tryIds = [];
    const queryId = value.startsWith('#') ? value.substring(1) : value;
    tryIds.push(queryId);
    if (queryId !== value) tryIds.push(value);

    // Candidate containers to search (root and root.data)
    const containers = [currentFullJSON, currentFullJSON.data].filter(Boolean);

    // First, try the mapped data map in each container
    if (dataMapKey) {
      for (const container of containers) {
        const dataMap = container[dataMapKey];
        if (dataMap && typeof dataMap === 'object') {
          for (const id of tryIds) {
            if (id in dataMap) {
              const resolved = dataMap[id];
              console.log(`Resolved ${key} via ${dataMapKey} in container: ${value} ->`, typeof resolved, resolved);
              return resolved;
            }
          }
        }
      }
    }

    // Fallback: scan all known maps in all containers
    for (const mapKey of Object.values(DATA_MAP_MAPPINGS)) {
      for (const container of containers) {
        const candidate = container[mapKey];
        if (!candidate || typeof candidate !== 'object') continue;
        for (const id of tryIds) {
          if (id in candidate) {
            const resolved = candidate[id];
            console.log(`Resolved ${key} via fallback ${mapKey} in container: ${value} ->`, typeof resolved, resolved);
            return resolved;
          }
        }
      }
    }

    // Return a special object indicating unresolved query
    return {
      __unresolved: true,
      originalQuery: value,
      queryId: queryId,
    };
  }

  function renderTree(root) {
    treeEl.innerHTML = '';
    if (!root) {
      setStatus('No root found');
      return;
    }
    currentRoot = root;
    const branch = createBranch(root, 0);
    branch.open = true;
    treeEl.appendChild(branch);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function loadDefault() {
    try {
      setStatus('Loading default JSON…');
      const res = await fetch(DEFAULT_JSON);
      if (!res.ok) throw new Error('Failed to fetch default JSON');
      const data = await res.json();
      currentFullJSON = data;
      const root = normalizeRoot(data);
      renderTree(root);
      setStatus(`Loaded: ${DEFAULT_JSON}`);
    } catch (e) {
      setStatus(e.message);
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.onload = () => {
        try { resolve(JSON.parse(String(reader.result))); }
        catch (e) { reject(new Error('Invalid JSON')); }
      };
      reader.readAsText(file);
    });
  }

  async function onFilePicked(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setStatus(`Reading ${file.name}…`);
      const data = await readFile(file);
      currentFullJSON = data;
      const root = normalizeRoot(data);
      renderTree(root);
      setStatus(`Loaded: ${file.name}`);
    } catch (e) {
      setStatus(e.message);
    }
  }

  loadDefaultBtn.addEventListener('click', loadDefault);
  fileInput.addEventListener('change', onFilePicked);
  expandAllBtn.addEventListener('click', () => {
    document.querySelectorAll('#tree details').forEach(d => d.open = true);
  });
  collapseAllBtn.addEventListener('click', () => {
    document.querySelectorAll('#tree details').forEach((d, i) => { d.open = i === 0; });
  });
  printStructureBtn.addEventListener('click', () => {
    if (currentRoot) {
      console.clear();
      console.log('=== Component Structure ===');
      printNodeStructure(currentRoot);
      console.log('=== End Structure ===');
      setStatus('Structure printed to console (open DevTools to view)');
      setTimeout(() => setStatus(''), 3000);
    } else {
      setStatus('No structure loaded');
    }
  });
  printJSONBtn.addEventListener('click', () => {
    if (currentFullJSON) {
      console.clear();
      console.log('=== Full JSON Object ===');
      console.log(currentFullJSON);
      console.log('=== End JSON ===');
      setStatus('Full JSON printed to console (open DevTools to view)');
      setTimeout(() => setStatus(''), 3000);
    } else {
      setStatus('No JSON loaded');
    }
  });
  clearSearchBtn.addEventListener('click', () => { searchInput.value = ''; applySearch(''); });
  searchInput.addEventListener('input', (e) => applySearch(e.target.value));

  function applySearch(query) {
    const q = String(query || '').trim().toLowerCase();
    const nodes = treeEl.querySelectorAll('details, .node');
    if (!q) {
      nodes.forEach(n => n.classList.remove('selected'));
      nodes.forEach(n => n.style.display = '');
      return;
    }
    nodes.forEach(n => {
      const label = n.querySelector('.label');
      const meta = n.querySelector('.meta');
      const hay = `${label ? label.textContent : ''} ${meta ? meta.textContent : ''}`.toLowerCase();
      const match = hay.includes(q);
      n.style.display = match ? '' : 'none';
      if (match) n.classList.add('selected'); else n.classList.remove('selected');
    });
    // Open all parents to reveal matches
    treeEl.querySelectorAll('details').forEach(d => {
      const anyVisible = d.querySelector(':scope > .children, :scope > summary');
      if (!anyVisible) return;
      const visible = d.querySelectorAll(':scope .node, :scope details').length !== d.querySelectorAll(':scope .node[style*="display: none"], :scope details[style*="display: none"]').length;
      if (visible) d.open = true;
    });
  }

  // Auto-load default on first paint
  window.addEventListener('DOMContentLoaded', loadDefault);
})();


