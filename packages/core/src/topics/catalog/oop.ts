import type { Topic } from '@levelhead/contracts'

export const OOP_TOPICS: readonly Topic[] = [
  {
    id: 'oop.polymorphism',
    area: 'oop',
    title: 'Polymorphism',
    ask: 'Ask them to explain polymorphism with a concrete example and how a method call reaches the right implementation.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'callers depend on an interface or base type, and each subtype supplies its own implementation',
        'runtime polymorphism through overriding and dynamic dispatch, for example a vtable lookup',
        'compile-time polymorphism through overloading or generics',
      ],
      trade_offs: [
        'new types can be added without changing callers (open/closed principle)',
        'the indirection makes control flow harder to trace',
        'dynamic dispatch costs an indirect call and can block inlining',
      ],
      failure_modes: [
        'a subtype that breaks the base contract (Liskov substitution violation)',
        'type checks like instanceof scattered through callers',
        'an override that silently changes behaviour the caller relied on',
      ],
    },
    falsePremise:
      'Method overloading is resolved at runtime from the actual type of the object, and that is what runtime polymorphism means.',
    twist:
      'a new payment method must be added every month by another team that cannot edit the checkout code',
  },
  {
    id: 'oop.composition_inheritance',
    area: 'oop',
    title: 'Composition vs inheritance',
    ask: 'Ask them when they would choose composition over inheritance and to justify it with an example.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'inheritance models is-a and reuses the parent implementation',
        'composition models has-a: the object holds other objects and delegates to them',
        'composed behaviour can be swapped at runtime behind an interface',
      ],
      trade_offs: [
        'inheritance is less code at first but couples the subclass to parent internals',
        'composition costs some delegation code but keeps classes independent and testable',
        'inheritance fits only when the subtype can truly stand in for the parent',
      ],
      failure_modes: [
        'fragile base class: a change in the parent silently breaks subclasses',
        'class explosion from combining features through subclasses',
        'a subclass inheriting methods that make no sense for it',
      ],
    },
    falsePremise:
      'Composition exists only as a workaround for languages without multiple inheritance, so in C++ you should always inherit instead.',
    twist:
      'a game character must gain and lose abilities like flying or swimming while the game is running',
  },
  {
    id: 'oop.four_pillars',
    area: 'oop',
    title: 'The four pillars of OOP',
    ask: 'Ask them to explain encapsulation, abstraction, inheritance and polymorphism, each with an example from code they have written.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'encapsulation: an object hides its state and changes it only through methods that keep it valid',
        'abstraction: callers use what an object does through an interface, not how it does it',
        'inheritance: a subclass reuses and extends a parent class',
        'polymorphism: one call works on objects of different types, each with its own behaviour',
      ],
      trade_offs: [
        'an abstract class shares code and state; an interface only fixes a contract, but a class can implement many',
        'deep inheritance reuses code but ties every subclass to the internals of its parents',
        'each extra layer of abstraction adds flexibility but makes the code harder to follow',
      ],
      failure_modes: [
        'a public getter and setter for every field, which exposes the state encapsulation was meant to protect',
        'a leaky abstraction that forces callers to know the implementation anyway',
        'inheritance used only to reuse code, for a type that is not really a kind of its parent',
      ],
    },
    falsePremise:
      'Encapsulation and abstraction are the same thing: both just mean marking fields private.',
    twist:
      'the bank account class is now used by ten other teams, and some of them set the balance directly',
  },
  {
    id: 'oop.solid',
    area: 'oop',
    title: 'SOLID principles',
    ask: 'Ask them to explain the SOLID principles and show one they have applied, or broken, in a real codebase.',
    minLevel: 'junior',
    expected: {
      mechanism: [
        'single responsibility: a class has one reason to change',
        'open/closed: new behaviour is added with new code rather than by editing working code',
        'Liskov substitution: a subtype must work anywhere its base type is expected',
        'interface segregation and dependency inversion: small interfaces, and high-level code depending on abstractions instead of concrete classes',
      ],
      trade_offs: [
        'more small classes and interfaces make each one easier to change but the whole harder to navigate',
        'dependency inversion lets tests swap in fakes, at the cost of extra indirection',
        'designing for extensions that never come adds complexity for nothing',
      ],
      failure_modes: [
        'a Square subclass of Rectangle that breaks callers who set the width and height separately',
        'a god class that has to change for every new feature',
        'an interface so wide that implementers throw "not supported" for half of it',
      ],
    },
    falsePremise:
      'The single responsibility principle means every class should have exactly one method.',
    twist:
      'the business logic must now be unit tested without the real database or the real email service',
  },
]
