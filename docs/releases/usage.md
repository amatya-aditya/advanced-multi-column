# Advanced Multi Column — Usage Examples

Copy any example below into an Obsidian note to see it in action.
For legacy callout syntax (`[!col]` / `[!col-md-*]`), see [legacy-usage.md](./legacy-usage.md).

---

# Part 1 — Basic Layouts

These examples cover the core building blocks: simple columns, custom widths, nested (parent/child) columns, and styled columns.

---

## 1. Simple Two-Column (Plain)

Two equal columns with basic markdown — headings, lists, and a blockquote.


%% col-start %%
%% col-break %%
### Pros
- Lightweight and fast
- Easy to learn
- Works offline
- Great community support

> "Simplicity is the ultimate sophistication."
%% col-break %%
### Cons
- Limited formatting options
- No real-time collaboration
- Steep learning curve for plugins
- Manual backups required
%% col-end %%


---

## 2. Three Columns with Custom Widths

An asymmetric layout — wider center column flanked by narrow sidebars.


%% col-start %%
%% col-break:20 %%
#### Links
- [[Home]]
- [[Projects]]
- [[Archive]]
- [[Tags]]
%% col-break:60 %%
#### Main Content

Markdown supports **bold**, *italic*, ~~strikethrough~~, and `inline code`. You can also create:

1. Ordered lists
2. With nested items
   - Like this one
   - And this

```python
print("Hello, columns!")
```
%% col-break:20 %%
#### Notes
> [!tip] Tip
> Use the 20/60/20 split for classic sidebar layouts.

**Status:** Draft
**Updated:** 2025-01-20
%% col-end %%


---

## 3. Nested Columns (Parent / Child)

A parent two-column layout where the right column contains its own child columns.


%% col-start %%
%% col-break:35 %%
## Sidebar

This is the outer left column. It stays as a single block while the right side has its own sub-layout.

- [[Dashboard]]
- [[Settings]]
- [[Help]]

| Key | Value |
| --- | ----- |
| Version | 2.1.0 |
| License | MIT |
%% col-break:65 %%
## Content Area

Below is a **nested** two-column block inside this column:

%% col-start %%
%% col-break %%
### Recent
1. Meeting notes — Jan 20
2. Research log — Jan 18
3. Design review — Jan 15
%% col-break %%
### Pinned
1. [[Quarterly Goals]]
2. [[Reading List]]
3. [[Workout Plan]]
%% col-end %%

Text after the nested block still belongs to the outer right column.
%% col-end %%


---

## 4. Styled Columns — Colors, Borders & Separators

Demonstrates background tints, border colors, separators, and container-level styling.


%% col-start:sb:1,bc:gray,b:primary %%
%% col-break:b:blue-soft,bc:blue,sb:1,t:text,sep:1,sc:blue,ss:dashed %%
### Blue Card
This column has a **blue tint** background, blue border, and a dashed blue separator on its right edge.

- Info item one
- Info item two
- Info item three
%% col-break:b:green-soft,bc:green,sb:1,t:text,sep:1,sc:green %%
### Green Card
This column has a **green tint** background with a green border and a solid green separator.

- Status: All clear
- Tests: Passing
- Build: Stable
%% col-break:b:orange-soft,bc:orange,sb:1,t:text %%
### Orange Card
This column has an **orange tint** background with an orange border. No separator on the last column.

- Warning: High CPU
- Disk: 78% used
- Memory: 4.2 GB free
%% col-end %%


**Style token reference used above:**
- `b:blue-soft` — background tint
- `bc:blue` — border color
- `sb:1` — show border
- `t:text` — text color
- `sep:1` — show separator
- `sc:blue` — separator color
- `ss:dashed` — separator line style


---

# Part 2 — Stacked Columns

Stacked columns let you place multiple columns vertically within the same horizontal slot. Use the `stk:1` token on consecutive `col-break` markers to group them into a stack. The stack group shares a single width and the columns within it are rendered top-to-bottom.

---

## 5. Basic Stacked Layout

Three stacked rows on the left, one tall column on the right.


%% col-start %%
%% col-break:40,stk:1 %%
### Row 1
First stacked row — occupies the top of the left slot.
%% col-break:stk:1 %%
### Row 2
Second stacked row — appears below Row 1.
%% col-break:stk:1 %%
### Row 3
Third stacked row — appears at the bottom of the left slot.
%% col-break:60 %%
### Wide Column
This column takes 60% of the width and spans the full height alongside the three stacked rows.
%% col-end %%


**Syntax breakdown:**
- `stk:1` — marks the column as stacked; consecutive stacked columns form a group
- The group's width is set by the first column in the stack (here `40`)
- Non-stacked columns (here `60`) flow normally beside the stack group

---

## 6. Cornell Note-Taking System

A classic study layout: title across the top, cues on the left, notes on the right.


%% col-start %%
%% col-break:stk:1 %%
**Topic / Title**
%% col-break:30,stk:1 %%
**Cues / Questions**

- Key term 1
- Key question
- Concept
%% col-break:70 %%
**Notes**

Main lecture or reading notes go here. The cues column on the left is stacked below the title, while this notes area spans the full height.
%% col-end %%


**How it works:**
- The title and cues columns share the `stk:1` flag, so they stack vertically in the left 30% slot
- The notes column occupies the remaining 70% at full height

---

## 7. Sidebar + Content

A simple 30/70 split for navigation or metadata sidebars.


%% col-start %%
%% col-break:30 %%
### Sidebar

- [[Dashboard]]
- [[Settings]]
- [[Archive]]
- [[Help]]
%% col-break:70 %%
### Main Content

Your primary content goes here. This layout works well for documentation, wiki pages, or any note that benefits from a persistent navigation sidebar.
%% col-end %%


---

## 8. Styled Stacked Layout

Combines stacking with visual styles for dashboards and status panels.


%% col-start:sb:1,bc:muted %%
%% col-break:35,stk:1,b:blue-soft,sb:1,bc:blue %%
### Status
- Build: Passing
- Tests: 42/42
- Coverage: 87%
%% col-break:stk:1,b:green-soft,sb:1,bc:green %%
### Uptime
- API: 99.97%
- Web: 99.95%
- DB: 99.99%
%% col-break:stk:1,b:orange-soft,sb:1,bc:orange %%
### Alerts
- High CPU on worker-3
- Disk 78% on db-primary
%% col-break:65 %%
### Activity Log

| Time | Event |
| ---- | ----- |
| 09:15 | Deployment v2.4.1 |
| 09:22 | Health check passed |
| 10:01 | Cache cleared |
| 11:30 | Backup completed |
| 14:45 | SSL cert renewed |
%% col-end %%


---

# Part 3 — Real-World Examples

Practical layouts modeled after real note-taking scenarios.

---

## 9. Machine Learning Study Notes

A study layout covering a neural network topic with theory, code, and reference.


%% col-start:sb:1,bc:muted,b:secondary %%
%% col-break:40,sep:1,sc:gray,ss:dotted %%
### Theory: Gradient Descent

Gradient descent minimizes a loss function $L(\theta)$ by iteratively updating parameters:

$$\theta_{t+1} = \theta_t - \eta \nabla L(\theta_t)$$

**Variants:**
- **Batch GD** — uses full dataset per step
- **Stochastic GD** — uses one sample per step
- **Mini-batch GD** — uses a subset (most common)

> [!note] Key Insight
> Learning rate $\eta$ controls step size. Too large = divergence. Too small = slow convergence.

**Convergence conditions:**
1. Convex loss → guaranteed global minimum
2. Non-convex loss → converges to local minimum
3. With momentum → escapes shallow local minima
%% col-break:30,sep:1,sc:gray,ss:dotted %%
### Code: PyTorch

```python
import torch
import torch.nn as nn

model = nn.Sequential(
    nn.Linear(784, 256),
    nn.ReLU(),
    nn.Dropout(0.2),
    nn.Linear(256, 10)
)

optimizer = torch.optim.Adam(
    model.parameters(),
    lr=0.001
)
criterion = nn.CrossEntropyLoss()

for epoch in range(20):
    for X, y in dataloader:
        pred = model(X)
        loss = criterion(pred, y)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
```
%% col-break:30 %%
### Quick Reference

| Optimizer | Best For |
| --------- | -------- |
| SGD | Simple models |
| Adam | General purpose |
| AdaGrad | Sparse data |
| RMSProp | RNNs |
| LBFGS | Small datasets |

**Hyperparameters:**
- Learning rate: `1e-3`
- Batch size: `32` or `64`
- Epochs: `10–100`
- Weight decay: `1e-5`

**Common pitfalls:**
- [ ] Forgetting to zero gradients
- [ ] Wrong input dimensions
- [ ] Not normalizing data
- [ ] Training on test set
%% col-end %%


---

## 10. History Notes — The Fall of the Roman Empire

A history study page with timeline, causes, and key figures laid out side by side.


%% col-start %%
%% col-break:45,sep:1,sc:muted %%
### Timeline of Decline

| Year | Event |
| ---- | ----- |
| 235–284 | Crisis of the Third Century |
| 285 | Diocletian splits the Empire |
| 313 | Edict of Milan — Christianity legalized |
| 376 | Visigoths cross the Danube |
| 410 | Sack of Rome by Alaric |
| 455 | Vandal sack of Rome |
| 476 | Romulus Augustulus deposed — **Western Empire falls** |

### Causes of the Fall

1. **Military overspending** — constant frontier defense drained the treasury
2. **Political instability** — 50+ emperors in 50 years during the Crisis
3. **Economic decline** — debasement of currency, heavy taxation
4. **Barbarian migrations** — Goths, Vandals, Huns pressed the borders
5. **Administrative bloat** — bureaucracy slowed decision-making
%% col-break:30,sep:1,sc:muted %%
### Key Figures

**Diocletian** (r. 284–305)
Split the empire into East and West. Introduced the Tetrarchy — four co-emperors ruling simultaneously.

**Constantine I** (r. 306–337)
Founded Constantinople. First emperor to convert to Christianity. Reunified the empire briefly.

**Theodosius I** (r. 379–395)
Last emperor to rule both halves. Made Christianity the state religion in 380.

**Alaric I** (Visigoth king)
Led the first sack of Rome in 800 years. Demanded land and recognition for his people.

**Odoacer** (Germanic chieftain)
Deposed the last Western emperor in 476. Became King of Italy.
%% col-break:25 %%
### Study Questions

> [!question] For review
> 1. Why did Diocletian split the empire?
> 2. How did Christianity change Roman governance?
> 3. Compare the Eastern and Western empire's fate.
> 4. Was the "fall" a sudden collapse or gradual transformation?

### Further Reading
- [[Gibbon — Decline and Fall]]
- [[Peter Heather — Fall of the Roman Empire]]
- [[Bryan Ward-Perkins — The Fall of Rome]]
- [[Late Antiquity Overview]]
%% col-end %%


---

## 11. Wikipedia-Style Article — The Great Barrier Reef

An encyclopedia-style layout with an info card sidebar and main article body.


%% col-start %%
%% col-break:65,sep:1,sc:gray %%
## The Great Barrier Reef

The **Great Barrier Reef** is the world's largest coral reef system, composed of over 2,900 individual reefs and 900 islands stretching over 2,300 kilometres along the northeast coast of Australia. It is visible from space and is the world's biggest single structure made by living organisms.

### Geography

The reef is located in the Coral Sea, off the coast of Queensland. It begins near the tip of Cape York Peninsula in the north and extends south to Bundaberg. The reef structure is composed of billions of tiny organisms known as *coral polyps*, held together by calcium carbonate.

### Biodiversity

The reef supports an extraordinary diversity of life:

- **1,500+** species of fish
- **400+** types of coral
- **4,000+** species of mollusk
- **240** species of birds
- **6** species of sea turtle breed there

> [!info] UNESCO Status
> The Great Barrier Reef was designated a **World Heritage Site** in 1981. It is managed by the Great Barrier Reef Marine Park Authority.

### Threats

| Threat | Impact | Severity |
| ------ | ------ | -------- |
| Climate change | Mass coral bleaching | Critical |
| Ocean acidification | Weakens coral structure | High |
| Cyclones | Physical reef damage | High |
| Agricultural runoff | Nutrient pollution | Moderate |
| Crown-of-thorns starfish | Coral predation | Moderate |

The reef experienced major bleaching events in 2016, 2017, 2020, and 2022, driven primarily by rising sea temperatures.
%% col-break:35,b:secondary,sb:1,bc:gray %%
### Quick Facts

| | |
| --- | --- |
| **Location** | Coral Sea, Queensland, Australia |
| **Length** | 2,300 km (1,430 mi) |
| **Area** | 344,400 km² |
| **Type** | Coral reef system |
| **Established** | ~20,000 years ago |
| **UNESCO** | 1981 |
| **Coordinates** | 18°17′S 147°42′E |

### Classification

- **Kingdom:** Animalia
- **Phylum:** Cnidaria
- **Class:** Anthozoa
- **Order:** Scleractinia

### See Also
- [[Coral Bleaching]]
- [[Marine Biology]]
- [[UNESCO World Heritage Sites]]
- [[Climate Change Effects on Oceans]]
- [[Great Barrier Reef Marine Park]]

### Did You Know?
> The reef generates **$6.4 billion** annually for the Australian economy through tourism, fishing, and scientific research. Over **2 million** tourists visit each year.
%% col-end %%


---

## 12. Cover / Information Card — Leonardo da Vinci

A profile-style layout inspired by book covers and biographical reference cards.


%% col-start:sb:1,bc:muted,b:primary %%
%% col-break:35,b:accent-soft,sb:1,bc:accent,sep:1,sc:accent,ss:solid,sw:2 %%
### Leonardo da Vinci
*1452 – 1519*

**Born:** Anchiano, Republic of Florence
**Died:** Amboise, Kingdom of France
**Fields:** Painting, sculpture, architecture, science, engineering, anatomy, geology, cartography

> "Learning never exhausts the mind."

---

**Known for:**
- Mona Lisa
- The Last Supper
- Vitruvian Man
- Flying machine designs
- Anatomical drawings

**Patrons:**
- Ludovico Sforza
- Cesare Borgia
- Pope Leo X
- Francis I of France
%% col-break:65 %%
### Biography

Leonardo di ser Piero da Vinci was an Italian polymath of the High Renaissance. He is widely considered one of the most diversely talented individuals ever to have lived.

#### Early Life
Born out of wedlock in Vinci, Tuscany, Leonardo was educated in the studio of the renowned Florentine painter Andrea del Verrocchio. His earliest known work is a drawing of the Arno valley, dated 1473.

#### Major Works

| Work | Year | Type | Location |
| ---- | ---- | ---- | -------- |
| Annunciation | 1472–1475 | Painting | Uffizi, Florence |
| Lady with an Ermine | 1489–1490 | Painting | National Museum, Kraków |
| The Last Supper | 1495–1498 | Mural | Santa Maria delle Grazie, Milan |
| Mona Lisa | 1503–1519 | Painting | Louvre, Paris |
| Vitruvian Man | c. 1490 | Drawing | Gallerie dell'Accademia, Venice |

#### Scientific Contributions

Leonardo's notebooks contain over **13,000 pages** of notes and drawings combining art and science. He studied:

1. **Anatomy** — dissected 30+ human corpses, mapping muscles and organs
2. **Hydraulics** — designed canals, locks, and water-lifting machines
3. **Aeronautics** — sketched ornithopters, parachutes, and helicopter screws
4. **Optics** — studied light, shadow, and the camera obscura

> [!abstract] Legacy
> Leonardo is often cited as the archetype of the "Renaissance man." His work influenced art for centuries and anticipated scientific discoveries by hundreds of years.
%% col-end %%


---

## 13. Kanban Board — Product Launch

A four-lane kanban board with color-coded status columns and realistic tasks.


%% col-start:sb:1,bc:muted %%
%% col-break:25,b:alt,sb:1,bc:gray,sep:1,sc:gray,ss:dashed %%
### Backlog
- [ ] Write press release
- [ ] Design launch email template
- [ ] Create social media assets
- [ ] Record product demo video
- [ ] Prepare FAQ document
- [ ] Set up analytics tracking
- [ ] Write App Store description

**6 items**
%% col-break:25,b:cyan-soft,sb:1,bc:cyan,sep:1,sc:cyan,ss:dashed %%
### In Progress
- [ ] Build landing page — *@Sarah*
- [ ] Finalize pricing tiers — *@Mike*
- [ ] Integration testing — *@Dev team*
- [ ] Write documentation — *@Alex*

> [!warning] Blocked
> Landing page waiting on final copy from marketing.

**4 items**
%% col-break:25,b:yellow-soft,sb:1,bc:yellow,sep:1,sc:yellow,ss:dashed %%
### Review
- [ ] Onboarding flow redesign — *needs QA*
- [ ] Payment integration — *needs security review*
- [ ] Terms of service update — *legal review*

---

**Deadline:** March 15
**Reviewer:** @Jordan

**3 items**
%% col-break:25,b:green-soft,sb:1,bc:green %%
### Done
- [x] Brand guidelines finalized
- [x] Domain purchased & DNS configured
- [x] SSL certificates installed
- [x] CI/CD pipeline set up
- [x] Staging environment deployed
- [x] Beta user feedback collected
- [x] Accessibility audit passed

**7 items**
%% col-end %%


---

## 14. Comparative Analysis — Programming Paradigms

A side-by-side comparison layout for studying contrasting concepts.


%% col-start:sb:1,bc:gray %%
%% col-break:50,b:blue-soft,sb:1,bc:blue,sep:1,sc:accent,sw:2 %%
### Object-Oriented Programming

**Core Principles:**
1. **Encapsulation** — bundle data and methods together
2. **Inheritance** — derive new classes from existing ones
3. **Polymorphism** — same interface, different implementations
4. **Abstraction** — hide complexity behind simple interfaces

**Example (Python):**
```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        raise NotImplementedError

class Dog(Animal):
    def speak(self):
        return f"{self.name} says Woof!"

class Cat(Animal):
    def speak(self):
        return f"{self.name} says Meow!"
```

**Best for:**
- Large codebases with many developers
- GUI applications and game engines
- Systems modeling real-world entities
- Enterprise software with complex business logic

**Languages:** Java, C#, Python, C++, Ruby
%% col-break:50,b:green-soft,sb:1,bc:green %%
### Functional Programming

**Core Principles:**
1. **Pure functions** — no side effects, same input = same output
2. **Immutability** — data never changes after creation
3. **First-class functions** — functions are values
4. **Composition** — build complex behavior from simple functions

**Example (Haskell):**
```haskell
-- Pure function
double :: [Int] -> [Int]
double = map (*2)

-- Function composition
processData :: [Int] -> [Int]
processData = filter (>10) . map (*2) . sort

-- Pattern matching
factorial :: Int -> Int
factorial 0 = 1
factorial n = n * factorial (n - 1)
```

**Best for:**
- Data transformation pipelines
- Concurrent and parallel processing
- Mathematical and scientific computing
- Compiler and language tool development

**Languages:** Haskell, Elixir, Clojure, F#, Scala
%% col-end %%


---

## 15. Weekly Meal Planner

A practical daily planner layout that anyone can relate to.


%% col-start:sb:1,bc:muted %%
%% col-break:b:alt,sep:1,sc:gray,ss:dotted %%
### Monday
**Breakfast:** Oatmeal with berries & honey
**Lunch:** Grilled chicken salad
**Dinner:** Pasta with marinara sauce
- [ ] Prep chicken marinade
%% col-break:b:alt,sep:1,sc:gray,ss:dotted %%
### Tuesday
**Breakfast:** Scrambled eggs & toast
**Lunch:** Turkey wrap with avocado
**Dinner:** Stir-fry with tofu & vegetables
- [ ] Buy tofu and bok choy
%% col-break:b:alt,sep:1,sc:gray,ss:dotted %%
### Wednesday
**Breakfast:** Greek yogurt & granola
**Lunch:** Leftover stir-fry
**Dinner:** Salmon with roasted asparagus
- [ ] Thaw salmon overnight
%% col-break:b:alt,sep:1,sc:gray,ss:dotted %%
### Thursday
**Breakfast:** Smoothie (banana, spinach, protein)
**Lunch:** Soup & bread
**Dinner:** Tacos with ground beef
- [ ] Buy tortillas and salsa
%% col-break:b:alt %%
### Friday
**Breakfast:** Pancakes with maple syrup
**Lunch:** BLT sandwich
**Dinner:** Homemade pizza night
- [ ] Make pizza dough in morning
%% col-end %%


---

Copy any of these examples into your Obsidian vault to see them render. Right-click any column in Live Preview to customize styles, borders, separators, and colors through the context menu. Use the **Insert layout** submenu in the editor context menu to quickly insert pre-built templates like Cornell Notes, Kanban Board, and Info Card layouts.

**Stacked column token reference:**
- `stk:1` — marks a column as stacked; consecutive stacked columns form a vertical group
- Stack groups share a single width slot (set by the first column in the group)
- Combine with any style tokens (`b:`, `bc:`, `sb:`, `sep:`, etc.) for styled stacks
