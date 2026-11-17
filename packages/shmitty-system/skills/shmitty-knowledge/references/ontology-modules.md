# Ontology modules

Declarations and labels do not need a role. Annotate every other triple with one `owl:Axiom` whose `sk:role` is `Shared`, `Requirement`, or `Inference`.

```turtle
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sk: <urn:shmitty:knowledge:> .
@prefix : <https://ontology.invalid/example#> .

# Shared: domain, range, subclass, and individual typing
:p rdfs:domain :A .
[] a owl:Axiom ; owl:annotatedSource :p ; owl:annotatedProperty rdfs:domain ;
   owl:annotatedTarget :A ; sk:role "Shared" .

# Requirement: reuse one labeled blank node in the axiom and its annotation
:A rdfs:subClassOf _:r1 .
_:r1 a owl:Restriction ; owl:onProperty :p ; owl:someValuesFrom :B .
[] a owl:Axiom ; owl:annotatedSource :A ; owl:annotatedProperty rdfs:subClassOf ;
   owl:annotatedTarget _:r1 ; sk:role "Requirement" .

# Named individual: the declaration and label need no role; the type assertion is Shared
:proto0 a owl:NamedIndividual ; rdfs:label "proto0" .
:proto0 a :Prototype .
[] a owl:Axiom ; owl:annotatedSource :proto0 ; owl:annotatedProperty rdf:type ;
   owl:annotatedTarget :Prototype ; sk:role "Shared" .

# Open question: the property comment states it; no Concept contains the filler class
:hasBlockLatency rdfs:comment "Open question: how long does a block take on Proto 0?" .

# Class from another topic: declare without a label
:ControlDevice a owl:Class .

# Plain tags
sk:plainTag a owl:AnnotationProperty .
<https://ontology.invalid/example> a owl:Ontology ; sk:plainTag "component" , "subsystem" .
```
