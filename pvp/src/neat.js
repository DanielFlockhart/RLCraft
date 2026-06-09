const fs = require('fs');
const path = require('path');
const { Config, Population, GenomeBuilder } = require('neat-javascript');
const sensors = require('./sensors');
const cfg = require('./config');

function outputSize(){
  const look = cfg.lookControls ? cfg.lookControls.length : 0;
  return cfg.movementControls.length + cfg.actions.length + look;
}
function inputSize(){ return sensors.stateSizeExample(); }

function makeConfig(){
  return new Config({
    inputSize: inputSize(),
    outputSize: outputSize(),
    populationSize: cfg.populationSize,
    numOfElite: Math.max(1, Math.floor(cfg.populationSize * cfg.elitismRatio)),
    survivalRate: cfg.elitismRatio,
    mutationRate: cfg.mutationRate,
    ...(cfg.neat || {})
  });
}

function createNeat(){
  const config = makeConfig();
  return new Population(config);
}

function evolve(pop){
  return pop.evolve();
}

function savePopulation(pop, filePath){
  const arr = pop.genomes.map(g => g.toJSON());
  const outPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({
    generation: pop.generation || 0,
    genomes: arr
  }, null, 2));
}

function loadPopulation(filePath){
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const config = makeConfig();
  const pop = new Population(config);
  if (Array.isArray(data.genomes)){
    pop.genomes = data.genomes.map(j => GenomeBuilder.loadGenome(j, config));
  }
  if (typeof data.generation === 'number') pop.generation = data.generation;
  if (typeof pop.speciate === 'function') pop.speciate();
  return pop;
}

module.exports = { createNeat, evolve, inputSize, outputSize, savePopulation, loadPopulation };
