import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useRefMock = vi.hoisted(() => vi.fn());
const useStateMock = vi.hoisted(() => vi.fn());
const useMemoMock = vi.hoisted(() => vi.fn());
const useCallbackMock = vi.hoisted(() => vi.fn());
const useEffectMock = vi.hoisted(() => vi.fn());
const mapInstances = vi.hoisted(() => [] as any[]);
const popupInstances = vi.hoisted(() => [] as any[]);
const markerInstances = vi.hoisted(() => [] as any[]);
const mapCtorError = vi.hoisted(() => ({ error: null as Error | null }));
const boundingBoxFromPositionsMock = vi.hoisted(() =>
  vi.fn((positions: [number, number][]) => ({ kind: 'bounds', positions })),
);
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: useRefMock,
    useState: useStateMock,
    useMemo: useMemoMock,
    useCallback: useCallbackMock,
    useEffect: useEffectMock,
  };
});
vi.mock('azure-maps-control', () => {
  class MapMock {
    options: unknown;
    handlers: Record<string, Array<{ target?: unknown; handler: (...args: any[]) => void }>>;
    markers: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
    events: { add: ReturnType<typeof vi.fn> };
    getCamera: ReturnType<typeof vi.fn>;
    setCamera: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;

    constructor(_container: unknown, options: unknown) {
      if (mapCtorError.error) {
        throw mapCtorError.error;
      }
      this.options = options;
      this.handlers = {};
      this.markers = {
        add: vi.fn(),
        remove: vi.fn(),
      };
      this.events = {
        add: vi.fn(
          (
            event: string,
            targetOrHandler: unknown,
            maybeHandler?: (...args: any[]) => void,
          ) => {
            const handler =
              typeof targetOrHandler === 'function'
                ? (targetOrHandler as (...args: any[]) => void)
                : maybeHandler;
          if (!handler) {
            return;
          }
          (this.handlers[event] ??= []).push({
            target: maybeHandler ? targetOrHandler : undefined,
            handler,
          });
          },
        ),
      };
      this.getCamera = vi.fn(() => ({
        bounds: [-122.5, 47.5, -122.0, 48.0],
      }));
      this.setCamera = vi.fn();
      this.dispose = vi.fn();
      mapInstances.push(this);
    }
  }

  class PopupMock {
    setOptions: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;

    constructor() {
      this.setOptions = vi.fn();
      this.open = vi.fn();
      popupInstances.push(this);
    }
  }

  class HtmlMarkerMock {
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      markerInstances.push(this);
    }
  }

  return {
    Map: MapMock,
    Popup: PopupMock,
    HtmlMarker: HtmlMarkerMock,
    AuthenticationType: {
      subscriptionKey: 'subscriptionKey',
    },
    data: {
      BoundingBox: {
        fromPositions: boundingBoxFromPositionsMock,
      },
    },
  };
});
vi.mock('azure-maps-control/dist/atlas.min.css', () => ({}));
vi.mock('lucide-react', () => ({
  AlertTriangle: 'svg',
  Loader2: 'svg',
}));

async function loadMapContainer() {
  return import('../MapContainer');
}

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any, any>) => boolean,
): React.ReactElement<any, any>[] {
  const elements: React.ReactElement<any, any>[] = [];

  const visit = (value: React.ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!React.isValidElement(value)) {
      return;
    }

    const element = value as React.ReactElement<any, any>;
    if (predicate(element)) {
      elements.push(element);
    }
    visit(element.props.children);
  };

  visit(node);
  return elements;
}

function queueRefs(refs: Array<{ current: unknown }>) {
  refs.forEach((ref) => {
    useRefMock.mockImplementationOnce(() => ref);
  });
}

const serviceOne = {
  service: {
    id: 'svc-1',
    name: 'Food Pantry',
  },
  organization: {
    name: 'Helping Hands',
  },
  location: {
    latitude: 47.61,
    longitude: -122.33,
  },
} as const;

const serviceTwo = {
  service: {
    id: 'svc-2',
    name: 'Shelter',
  },
  organization: {
    name: 'Safe Harbor',
  },
  location: {
    latitude: 47.62,
    longitude: -122.31,
  },
} as const;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  useRefMock.mockImplementation(() => ({ current: null }));
  useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
  useMemoMock.mockImplementation((factory: () => unknown) => factory());
  useCallbackMock.mockImplementation((fn: unknown) => fn);
  useEffectMock.mockImplementation(() => undefined);

  mapInstances.length = 0;
  popupInstances.length = 0;
  markerInstances.length = 0;
  mapCtorError.error = null;

  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MapContainer', () => {
  it('renders loading and error branches based on component state', async () => {
    const { MapContainer } = await loadMapContainer();

    queueRefs([
      { current: null },
      { current: null },
      { current: [] },
      { current: null },
    ]);
    useStateMock
      .mockImplementationOnce(() => [null, vi.fn()])
      .mockImplementationOnce(() => [true, vi.fn()]);

    const loadingElement = MapContainer({ className: 'h-48' }) as React.ReactElement<any, any>;
    const loadingStates = collectElements(
      loadingElement,
      (child) => child.props.role === 'status' && child.props['aria-label'] === 'Loading map',
    );

    expect(loadingStates).toHaveLength(1);

    queueRefs([
      { current: null },
      { current: null },
      { current: [] },
      { current: null },
    ]);
    useStateMock
      .mockImplementationOnce(() => ['Azure Maps is not configured. Contact your administrator.', vi.fn()])
      .mockImplementationOnce(() => [false, vi.fn()]);

    const errorElement = MapContainer({ className: 'h-48' }) as React.ReactElement<any, any>;
    const alerts = collectElements(errorElement, (child) => child.props.role === 'alert');

    expect(alerts).toHaveLength(1);
    expect(collectElements(errorElement, (child) => child.type === 'svg')).not.toHaveLength(0);
  });

  it('initializes the map and sets error state when no token is available', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
    });
    const setMapError = vi.fn();
    const setIsLoading = vi.fn();
    const effects: Array<() => void | (() => void)> = [];
    useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
      effects.push(effect);
    });
    const containerRef = { current: { node: true } };
    const mapRef = { current: null };
    const markersRef = { current: [] as unknown[] };
    const popupRef = { current: null };
    queueRefs([containerRef, mapRef, markersRef, popupRef]);
    useStateMock
      .mockImplementationOnce(() => [null, setMapError])
      .mockImplementationOnce(() => [true, setIsLoading]);
    const { MapContainer } = await loadMapContainer();

    MapContainer({ className: 'h-48' });
  effects[1]();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/maps/token',
      expect.objectContaining({
        credentials: 'same-origin',
      }),
    );
    expect(setMapError).toHaveBeenCalledWith('Azure Maps is not configured. Contact your administrator.');
    expect(setIsLoading).toHaveBeenCalledWith(false);
    expect(mapInstances).toHaveLength(0);
  });

  it('manages map lifecycle, markers, bounds updates, and popup clicks', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ subscriptionKey: 'atlas-key' }),
    });
    const setMapError = vi.fn();
    const setIsLoading = vi.fn();
    const onBoundsChange = vi.fn();
    const effects: Array<() => void | (() => void)> = [];
    useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
      effects.push(effect);
    });
    const containerRef = { current: { node: true } };
    const mapRef = { current: null as unknown };
    const markersRef = { current: [] as unknown[] };
    const popupRef = { current: null as unknown };
    queueRefs([containerRef, mapRef, markersRef, popupRef]);
    useStateMock
      .mockImplementationOnce(() => [null, setMapError])
      .mockImplementationOnce(() => [false, setIsLoading]);
    const { MapContainer } = await loadMapContainer();

    const regionElement = MapContainer({
      services: [serviceOne, serviceTwo] as never,
      onBoundsChange,
      className: 'h-48',
    }) as React.ReactElement<any, any>;
    const regions = collectElements(
      regionElement,
      (child) =>
        child.props.role === 'application'
        && typeof child.props['aria-label'] === 'string'
        && child.props['aria-label'].includes('Interactive service map'),
    );

    expect(regions).toHaveLength(1);

    const cleanup = effects[1]() as () => void;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mapInstances).toHaveLength(1);
    const map = mapInstances[0];
    expect(map.options).toEqual(
      expect.objectContaining({
        authOptions: {
          authType: 'subscriptionKey',
          subscriptionKey: 'atlas-key',
        },
      }),
    );

    map.handlers.ready[0].handler();
    expect(setIsLoading).toHaveBeenCalledWith(false);
    expect(onBoundsChange).toHaveBeenCalledWith({
      minLng: -122.5,
      minLat: 47.5,
      maxLng: -122.0,
      maxLat: 48.0,
    });

    effects[2]();

    expect(map.markers.add).toHaveBeenCalledWith(expect.arrayContaining(markerInstances));
    expect(boundingBoxFromPositionsMock).toHaveBeenCalledWith([
      [-122.33, 47.61],
      [-122.31, 47.62],
    ]);
    expect(map.setCamera).toHaveBeenCalledWith({
      bounds: {
        kind: 'bounds',
        positions: [
          [-122.33, 47.61],
          [-122.31, 47.62],
        ],
      },
      padding: 60,
    });

    const clickHandler = map.handlers.click[0];
    clickHandler.handler();

    expect(popupInstances[0].setOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        position: [-122.33, 47.61],
        content: expect.stringContaining('Food Pantry'),
      }),
    );
    expect(popupInstances[0].open).toHaveBeenCalledWith(map);

    map.handlers.moveend[0].handler();
    expect(onBoundsChange).toHaveBeenCalledTimes(2);

    cleanup();

    expect(map.dispose).toHaveBeenCalledOnce();
    expect(mapRef.current).toBeNull();
    expect(markersRef.current).toEqual([]);
    expect(popupRef.current).toBeNull();
    expect(setMapError).not.toHaveBeenCalled();
  });

  it('supports keyboard map navigation controls', async () => {
    const setCamera = vi.fn();
    const mapRef = {
      current: {
        getCamera: vi.fn(() => ({ center: [-122.33, 47.61], zoom: 4 })),
        setCamera,
      },
    };
    queueRefs([
      { current: { node: true } },
      mapRef,
      { current: [] },
      { current: null },
    ]);
    useStateMock
      .mockImplementationOnce(() => [null, vi.fn()])
      .mockImplementationOnce(() => [false, vi.fn()]);

    const { MapContainer } = await loadMapContainer();
    const element = MapContainer({
      centerLat: 40,
      centerLng: -99,
      zoom: 5,
      className: 'h-48',
    }) as React.ReactElement<any, any>;
    const app = collectElements(
      element,
      (child) => child.props.role === 'application',
    )[0];
    expect(app).toBeDefined();

    const emit = (key: string) => {
      const preventDefault = vi.fn();
      app.props.onKeyDown({ key, preventDefault });
      return preventDefault;
    };

    expect(emit('ArrowUp')).toHaveBeenCalledOnce();
    expect(emit('ArrowDown')).toHaveBeenCalledOnce();
    expect(emit('ArrowLeft')).toHaveBeenCalledOnce();
    expect(emit('ArrowRight')).toHaveBeenCalledOnce();
    expect(emit('+')).toHaveBeenCalledOnce();
    expect(emit('=')).toHaveBeenCalledOnce();
    expect(emit('-')).toHaveBeenCalledOnce();
    expect(emit('R')).toHaveBeenCalledOnce();
    expect(emit('x')).not.toHaveBeenCalled();

    const calls = setCamera.mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({ center: [-122.33, 47.71] });
    expect(calls[1]).toEqual({ center: [-122.33, 47.51] });
    expect((calls[2].center as [number, number])[0]).toBeCloseTo(-122.43, 8);
    expect((calls[2].center as [number, number])[1]).toBeCloseTo(47.61, 8);
    expect(calls[3]).toEqual({ center: [-122.23, 47.61] });
    expect(calls[4]).toEqual({ zoom: 5 });
    expect(calls[5]).toEqual({ zoom: 5 });
    expect(calls[6]).toEqual({ zoom: 3 });
    expect(calls[7]).toEqual({ center: [-99, 40], zoom: 4 });
  });

  it('centers camera directly when exactly one pin is available', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ subscriptionKey: 'atlas-key' }),
    });
    const effects: Array<() => void | (() => void)> = [];
    useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
      effects.push(effect);
    });
    queueRefs([
      { current: { node: true } },
      { current: null },
      { current: [] },
      { current: null },
    ]);
    useStateMock
      .mockImplementationOnce(() => [null, vi.fn()])
      .mockImplementationOnce(() => [false, vi.fn()]);
    const { MapContainer } = await loadMapContainer();

    MapContainer({
      services: [serviceOne] as never,
      className: 'h-48',
    });

    effects[1]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mapInstances).toHaveLength(1);
    const map = mapInstances[0];
    effects[2]();

    expect(map.markers.add).toHaveBeenCalled();
    expect(map.setCamera).toHaveBeenCalledWith({ center: [-122.33, 47.61], zoom: 13 });
    expect(boundingBoxFromPositionsMock).not.toHaveBeenCalled();
  });

  it('captures map initialization constructor failures and sets error state', async () => {
    mapCtorError.error = new Error('atlas init failed');
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ subscriptionKey: 'atlas-key' }),
    });
    const setMapError = vi.fn();
    const setIsLoading = vi.fn();
    const effects: Array<() => void | (() => void)> = [];
    useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
      effects.push(effect);
    });
    queueRefs([
      { current: { node: true } },
      { current: null },
      { current: [] },
      { current: null },
    ]);
    useStateMock
      .mockImplementationOnce(() => [null, setMapError])
      .mockImplementationOnce(() => [true, setIsLoading]);
    const { MapContainer } = await loadMapContainer();

    MapContainer({ className: 'h-48' });
    effects[1]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(setMapError).toHaveBeenCalledWith('atlas init failed');
    expect(setIsLoading).toHaveBeenCalledWith(false);
  });

  it('removes previously-rendered markers before adding the next marker set', async () => {
    const oldMarkers = [{ id: 'old-1' }];
    const map = {
      markers: {
        remove: vi.fn(),
        add: vi.fn(),
      },
      events: {
        add: vi.fn(),
      },
      setCamera: vi.fn(),
    };
    const effects: Array<() => void | (() => void)> = [];
    useEffectMock.mockImplementation((effect: () => void | (() => void)) => {
      effects.push(effect);
    });
    const markersRef = { current: oldMarkers as unknown[] };
    queueRefs([
      { current: { node: true } },
      { current: map },
      markersRef,
      { current: null },
    ]);
    useStateMock
      .mockImplementationOnce(() => [null, vi.fn()])
      .mockImplementationOnce(() => [false, vi.fn()]);
    const { MapContainer } = await loadMapContainer();

    MapContainer({
      services: [serviceOne] as never,
      className: 'h-48',
    });
    effects[2]();

    expect(map.markers.remove).toHaveBeenCalledWith(oldMarkers);
    expect(map.markers.add).toHaveBeenCalled();
    expect(markersRef.current.length).toBeGreaterThan(0);
  });
});
