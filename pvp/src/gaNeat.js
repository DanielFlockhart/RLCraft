const { createNeat, evolve, savePopulation, loadPopulation }=require('./neat');
function assignNetworksToIndividuals(pop, population){ for(let i=0;i<population.length;i++){ population[i].net=pop.genomes[i]; } }
function writeFitnessToNetworks(pop, population){
  for(let i=0;i<population.length;i++){
    const ind = population[i];
    const score = (typeof ind.fitness === 'number' && !Number.isNaN(ind.fitness)) ? ind.fitness : (ind.maxDist || 0);
    pop.genomes[i].fitness = score;
  }
}
module.exports={createNeat,evolve,assignNetworksToIndividuals,writeFitnessToNetworks,savePopulation,loadPopulation};
