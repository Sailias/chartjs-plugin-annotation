import {Animations, Chart} from 'chart.js';
import {clipArea, unclipArea, isFinite, clone, merge, resolve, valueOrDefault, isObject, isArray} from 'chart.js/helpers';
import {handleEvent, updateListeners} from './events';
import BoxAnnotation from './types/box';
import LineAnnotation from './types/line';
import EllipseAnnotation from './types/ellipse';
import PointAnnotation from './types/point';

const chartStates = new Map();

const annotationTypes = {
  box: BoxAnnotation,
  line: LineAnnotation,
  ellipse: EllipseAnnotation,
  point: PointAnnotation
};

export default {
  id: 'annotation',

  afterRegister() {
    Chart.register(annotationTypes);
  },

  afterUnregister() {
    Chart.unregister(annotationTypes);
  },

  beforeInit(chart) {
    chartStates.set(chart, {
      elements: [],
      options: {},
      listeners: {},
      listened: false,
      moveListened: false,
      scales: new Set()
    });
  },

  beforeUpdate(chart, args, options) {
    const state = chartStates.get(chart);
    state.options = clone(options);
    const annotations = state.options.annotations;

    if (isObject(annotations)) {
      const array = new Array();
      Object.keys(annotations).forEach(key => {
        let value = annotations[key];
        if (isObject(value)) {
          value.id = key;
          array.push(resolveAnnotationOptions(chart, value));
        }
      });
      state.options.annotations = array;
    } else if (isArray(annotations)) {
      for (var i = 0; i < annotations.length; i++) {
        annotations[i] = resolveAnnotationOptions(chart, annotations[i]);
      }
    } else {
      state.options.annotations = [];
    }
  },

  afterDataLimits(chart, args) {
    if (args.scale.type !== 'category') {
      const state = chartStates.get(chart);
      adjustScaleRange(args.scale, state.options);
    }
  },

  afterUpdate(chart, args) {
    const state = chartStates.get(chart);
    updateListeners(chart, state);
    updateElements(chart, state, args.mode);
  },

  beforeDatasetsDraw(chart) {
    draw(chart, 'beforeDatasetsDraw');
  },

  afterDatasetsDraw(chart) {
    draw(chart, 'afterDatasetsDraw');
  },

  beforeDraw(chart) {
    draw(chart, 'beforeDraw');
  },

  afterDraw(chart) {
    draw(chart, 'afterDraw');
  },

  beforeEvent(chart, args) {
    const state = chartStates.get(chart);
    handleEvent(chart, state, args.event);
  },

  destroy(chart) {
    chartStates.delete(chart);
  },

  _getState(chart) {
    return chartStates.get(chart);
  },

  defaults: {
    drawTime: 'afterDatasetsDraw',
    dblClickSpeed: 350, // ms
    annotations: {},
    animation: {
      numbers: {
        properties: ['x', 'y', 'x2', 'y2', 'width', 'height'],
        type: 'number'
      },
    }
  },
};

const directUpdater = {
  update: Object.assign
};

function resolveAnnotationOptions(chart, options) {
  const elType = annotationTypes[options.type] || annotationTypes.line;
  const elOptions = merge(Object.create(null), [elType.defaults, chart.options.elements[elType.id], options]);
  elOptions.display = !!resolve([elOptions.display, true], {chart, options: elOptions});
  return elOptions;
}

function resolveAnimations(chart, animOpts, mode) {
  if (mode === 'reset' || mode === 'none' || mode === 'resize') {
    return directUpdater;
  }
  return new Animations(chart, animOpts);
}

function updateElements(chart, state, mode) {
  const options = state.options;
  const chartAnims = chart.options.animation;
  const animOpts = chartAnims && merge({}, [chartAnims, options.animation]);
  const animations = resolveAnimations(chart, animOpts, mode);

  const annotations = options.annotations || [];
  const elements = resyncElements(state.elements, annotations);

  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i];
    let el = elements[i];
    const elType = annotationTypes[annotation.type] || annotationTypes.line;
    if (!el || !(el instanceof elType)) {
      el = elements[i] = new elType();
    }
    const properties = el.resolveElementProperties(chart, annotation);
    properties.options = annotation;
    animations.update(el, properties);
  }
}

function resyncElements(elements, annotations) {
  const count = annotations.length;
  const start = elements.length;

  if (start < count) {
    const add = count - start;
    elements.splice(start, 0, ...new Array(add));
  } else if (start > count) {
    elements.splice(count, start - count);
  }
  return elements;
}

function draw(chart, caller) {
  const {ctx, chartArea} = chart;
  const state = chartStates.get(chart);
  const options = state.options;
  const elements = state.elements.filter(el => el.options.display);

  clipArea(ctx, chartArea);
  elements.forEach(el => {
    if ((el.options.drawTime || options.drawTime || caller) === caller) {
      el.draw(ctx);
    }
  });
  unclipArea(ctx);

  elements.forEach(el => {
    if ('drawLabel' in el && el.options.label && (el.options.label.drawTime || el.options.drawTime || options.drawTime || caller) === caller) {
      el.drawLabel(ctx, chartArea);
    }
  });
}

function adjustScaleRange(scale, options) {
  const annotations = options.annotations.filter(annotation => annotation.display);
  const range = getScaleLimits(scale, annotations);
  let changed = false;
  if (isFinite(range.min) &&
		typeof scale.options.min === 'undefined' &&
		typeof scale.options.suggestedMin === 'undefined') {
    changed = scale.min !== range.min;
    scale.min = range.min;
  }
  if (isFinite(range.max) &&
		typeof scale.options.max === 'undefined' &&
		typeof scale.options.suggestedMax === 'undefined') {
    changed = scale.max !== range.max;
    scale.max = range.max;
  }
  if (changed && typeof scale.handleTickRangeOptions === 'function') {
    scale.handleTickRangeOptions();
  }
}

function getScaleLimits(scale, annotations) {
  const axis = scale.axis;
  const scaleID = scale.id;
  const scaleIDOption = scale.axis + 'ScaleID';
  const scaleAnnotations = annotations.filter(annotation => annotation[scaleIDOption] === scaleID || annotation.scaleID === scaleID);
  let min = valueOrDefault(scale.min, Number.NEGATIVE_INFINITY);
  let max = valueOrDefault(scale.max, Number.POSITIVE_INFINITY);
  scaleAnnotations.forEach(annotation => {
    ['value', 'endValue', axis + 'Min', axis + 'Max', axis + 'Value'].forEach(prop => {
      if (prop in annotation) {
        const value = scale.parse(annotation[prop]);
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    });
  });
  return {min, max};
}
