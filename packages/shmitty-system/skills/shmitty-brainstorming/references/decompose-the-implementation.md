# Decompose the Implementation

Use the idea model's existing implementation items. When none exist, create the first one once the work is scopable: its deliverable fits one sentence, subjects to be modified are named, and each of its done conditions comes from the long-horizon outcome. Make it a child of the idea model. Do not create **steps** until the work is scopable.

## 1. Collect the existing design decisions

Collect each decision that binds an implementation item: in design documents, in its description and acceptance criteria, in closed **decisions**, and in code it builds on. Record each source.

## 2. Create the steps

Create **steps** as children of the idea model, ordered with blocking dependencies.

- Record the design decisions that a step must honor, with its sources, in its description.
- Map each acceptance criterion of the idea model to the done condition of one step.
- Block each step on the open **decisions** that constrain them.
- When a step needs a choice that is not already covered by the idea model, create a blocking **decision** for it.

## 3. Apply a closed decision

Write the outcome into the description of each **step** it blocked. Create or split the steps that an outcome reveals.

If no implementation item exists yet, check whether the work is now scopable, and if it is then follow steps 1-3.
