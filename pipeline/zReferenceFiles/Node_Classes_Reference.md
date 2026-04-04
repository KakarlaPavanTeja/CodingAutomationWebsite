# Node Class References

This document outlines the standard `Node` class definitions used internally by the automation pipeline for Binary Tree and Linked List problems.
When providing your initial solution in `Inputs/solution.py` (or other languages), **you MUST use these exact class definitions**.

---

## 🌳 Binary Tree Node

### Python
```python
class Node:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
```

### C++
```cpp
class Node {
public:
    int val;
    Node* left;
    Node* right;
    Node(int val) : val(val), left(nullptr), right(nullptr) {}
};
```

### Java
```java
class Node {
    int val;
    Node left, right;
    Node(int val) {
        this.val = val;
        this.left = null;
        this.right = null;
    }
}
```

### Node.js
```javascript
class Node {
    constructor(val) {
        this.val = val;
        this.left = null;
        this.right = null;
    }
}
```

---

## 🔗 Linked List Node

### Python
```python
class Node:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
```

### C++
```cpp
class Node {
public:
    int val;
    Node* next;
    Node(int val, Node* next) : val(val), next(next) {}
    Node(int val) : val(val), next(nullptr) {}
};
```

### Java
```java
class Node {
    int val;
    Node next;
    public Node(int val, Node next) {
        this.val = val;
        this.next = next;
    }
    public Node(int val) {
        this(val, null);
    }
}
```

### Node.js
```javascript
class Node {
  constructor(val, next = null) {
    this.val = val;
    this.next = next;
  }
}
```
