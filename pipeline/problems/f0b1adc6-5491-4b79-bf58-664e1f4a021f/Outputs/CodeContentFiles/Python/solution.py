class solution:
    def locatePairPositions(self, values, required):
        seen = {}
        for i, num in enumerate(values):
            complement = required - num
            if complement in seen:
                return [seen[complement], i]
            seen[num] = i
        return []
