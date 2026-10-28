// Per-station configuration. Pure data: what each station is like, not what is
// happening there right now (that's StationRound in round.js).
//
// Each entry: { number, name, passengerCount, dwellSeconds, allowedTypes }
// The numbers follow the spec's difficulty rule (CONFIG.difficulty). To hand-tune
// one station, overwrite fields after the map below, e.g.
//   STATIONS[7].passengerCount = 40;

// "Craig St" comes from the spec's HUD example; the rest are made up.
const STATION_NAMES = [
  'Harbour Rd',
  'Craig St',
  'Mill Lane',
  'Union Square',
  'Kettle Park',
  'Ashby Junction',
  'Northgate',
  'End of the Line',
];

// Passenger types that can spawn at a station, from each type's firstStation.
function passengerTypesAllowedAt(stationNumber) {
  return Object.keys(PASSENGER_TYPES).filter((typeKey) => {
    const firstStation = PASSENGER_TYPES[typeKey].firstStation;
    return firstStation !== null && firstStation <= stationNumber;
  });
}

const STATIONS = STATION_NAMES.map((name, index) => {
  const difficulty = CONFIG.difficulty;
  return {
    number: index + 1,
    name,
    passengerCount: difficulty.firstStationPassengers + index * difficulty.passengersAddedPerStation,
    dwellSeconds: Math.max(
      difficulty.minimumDwellSeconds,
      difficulty.firstStationDwellSeconds - index * difficulty.dwellSecondsRemovedPerStation,
    ),
    allowedTypes: passengerTypesAllowedAt(index + 1),
  };
});
